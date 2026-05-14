/**
 * Fetches Hearthstone keyword definitions from the community wiki:
 *   https://hearthstone.wiki.gg/api.php
 *
 * Free, no auth, CORS open via `origin=*`. NO local caching — always fetch
 * fresh so the user gets the latest definitions on every page load.
 *
 * Strategy (zero hardcoded mappings):
 *   1. Convert each mechanic enum to a natural-language search query
 *      ("BATTLE_CRY" → "battle cry").
 *   2. Run the wiki's full-text search API for every mechanic in parallel —
 *      CirrusSearch handles plurals, tense, redirects, and disambiguation
 *      natively, so we don't need to encode any of that ourselves.
 *   3. Batch-fetch extracts for every unique top-hit title via a single
 *      `prop=extracts` query that follows redirects + normalization.
 *
 * Whenever Blizzard adds a new mechanic or the wiki renames a page, the
 * mapping updates automatically — no code change required.
 */

const WIKI_ENDPOINT = 'https://hearthstone.wiki.gg/api.php';

/** Anonymous users may request at most 50 titles per query. */
const TITLE_BATCH = 50;

export type KeywordMap = Record<string, string>;

interface MwExtractPage {
  title: string;
  extract?: string;
  missing?: boolean;
}

interface MwRedirect {
  from: string;
  to: string;
}

interface MwNormalized {
  from: string;
  to: string;
}

interface MwSearchResult {
  title: string;
}

/** Convert mechanic enum form to a natural-language search query. */
function mechanicToQuery(mechanic: string): string {
  return mechanic.toLowerCase().replace(/_/g, ' ').trim();
}

/** Strip wiki extract to a tight one-paragraph description. */
function cleanExtract(raw: string): string {
  const firstPara = raw.split(/\n\s*\n/)[0] ?? raw;
  return firstPara.replace(/\s+/g, ' ').trim();
}

/** Wiki full-text search: return top hit title for a query, if any. */
async function wikiSearchTop(query: string): Promise<string | null> {
  const url = new URL(WIKI_ENDPOINT);
  url.searchParams.set('action', 'query');
  url.searchParams.set('list', 'search');
  url.searchParams.set('srsearch', query);
  url.searchParams.set('srnamespace', '0');
  url.searchParams.set('srlimit', '1');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('origin', '*');

  const r = await fetch(url.toString());
  if (!r.ok) return null;
  const json = (await r.json()) as { query?: { search?: MwSearchResult[] } };
  return json.query?.search?.[0]?.title ?? null;
}

/** Pull `extract` for a list of titles in batches, following redirects/normalize. */
async function fetchExtractsByTitles(titles: string[]): Promise<{
  map: Map<string, string>;
  redirects: Map<string, string>;
  normalized: Map<string, string>;
}> {
  const map = new Map<string, string>();
  const redirects = new Map<string, string>();
  const normalized = new Map<string, string>();

  for (let i = 0; i < titles.length; i += TITLE_BATCH) {
    const batch = titles.slice(i, i + TITLE_BATCH);
    const url = new URL(WIKI_ENDPOINT);
    url.searchParams.set('action', 'query');
    url.searchParams.set('titles', batch.join('|'));
    url.searchParams.set('redirects', '1');
    url.searchParams.set('prop', 'extracts');
    url.searchParams.set('exlimit', 'max');
    url.searchParams.set('exintro', '1');
    url.searchParams.set('explaintext', '1');
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    url.searchParams.set('origin', '*');

    const r = await fetch(url.toString());
    if (!r.ok) throw new Error(`wiki extracts ${r.status}`);
    const json = (await r.json()) as {
      query?: {
        pages?: MwExtractPage[];
        redirects?: MwRedirect[];
        normalized?: MwNormalized[];
      };
    };

    for (const n of json.query?.normalized ?? []) normalized.set(n.from, n.to);
    for (const rd of json.query?.redirects ?? []) redirects.set(rd.from, rd.to);
    for (const p of json.query?.pages ?? []) {
      if (p.missing || !p.title || !p.extract) continue;
      map.set(p.title, p.extract);
    }
  }

  return { map, redirects, normalized };
}

/** Resolve a requested title through normalize + redirect maps. */
function resolveTitle(
  requested: string,
  normalized: Map<string, string>,
  redirects: Map<string, string>,
): string {
  let t = normalized.get(requested) ?? requested;
  for (let i = 0; i < 3 && redirects.has(t); i++) t = redirects.get(t)!;
  return t;
}

/** Run async fn over each item with bounded concurrency to avoid burst-rate-limits. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Module-level in-flight cache: concurrent callers (e.g. React StrictMode
 *  double-invoke in dev) share one fetch instead of stampeding the wiki. */
let inflight: Promise<KeywordMap> | null = null;
let inflightKey: string | null = null;

/**
 * Main entry. Pass the set of tag enum values you want defined (mechanics +
 * referencedTags etc.). Returns a definition for every tag the wiki has a
 * page for. Tags with no page are silently omitted.
 */
export async function loadKeywordMap(tags: Iterable<string>): Promise<KeywordMap> {
  const wanted = [...new Set(tags)].sort();
  if (wanted.length === 0) return {};

  const key = wanted.join('|');
  if (inflight && inflightKey === key) return inflight;

  inflightKey = key;
  inflight = (async () => {
    try {
      // 1. Search with bounded concurrency — CirrusSearch handles
      //    plurals/redirects/tense, but bursting 60+ requests trips the
      //    wiki's per-IP rate limit (HTTP 429). 8 at a time is comfortable.
      const searchResults = await mapWithConcurrency(wanted, 8, async (mechanic) => {
        const title = await wikiSearchTop(mechanicToQuery(mechanic));
        return { mechanic, title };
      });

      const titlesByMechanic = new Map<string, string>();
      const uniqueTitles: string[] = [];
      for (const { mechanic, title } of searchResults) {
        if (!title) continue;
        titlesByMechanic.set(mechanic, title);
        if (!uniqueTitles.includes(title)) uniqueTitles.push(title);
      }

      if (uniqueTitles.length === 0) return {};

      const { map, redirects, normalized } = await fetchExtractsByTitles(uniqueTitles);

      const result: KeywordMap = {};
      for (const [mechanic, title] of titlesByMechanic) {
        const resolved = resolveTitle(title, normalized, redirects);
        const ex = map.get(resolved);
        if (ex) result[mechanic] = cleanExtract(ex);
      }
      return result;
    } catch {
      return {};
    } finally {
      // Hold the result for the rest of the session; clear only if it failed
      // (empty map) so a future retry can succeed.
      // Note: we keep a non-empty result indefinitely to avoid hammering the wiki.
    }
  })();

  const result = await inflight;
  if (Object.keys(result).length === 0) {
    // Allow retry on next call if we got nothing.
    inflight = null;
    inflightKey = null;
  }
  return result;
}
