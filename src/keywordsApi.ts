/**
 * Fetches Hearthstone keyword definitions from the community wiki:
 *   https://hearthstone.wiki.gg/api.php
 *
 * Free, no auth, CORS open via `origin=*`. NO local caching — always fetch
 * fresh so the user gets the latest definitions on every page load.
 *
 * Strategy (fully dynamic, no hardcoded aliases):
 *   1. Take the set of unique `mechanics` enum values that actually appear
 *      on cards (passed in by the caller).
 *   2. For each mechanic, generate candidate wiki titles by transforming
 *      the enum (Title Case, joined words, suffix stripping, simple
 *      singular/past-tense reduction).
 *   3. Batch-query MediaWiki with `redirects=1` so common variant titles
 *      resolve automatically (e.g. "Side Quest" → "Sidequest").
 *   4. Any mechanic still without an extract is resolved via the wiki
 *      search API (`list=search`) — pick the top hit and re-fetch its
 *      extract.
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

/** Capitalize first letter, lowercase the rest. */
function titleWord(w: string): string {
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

/**
 * Generate candidate wiki titles from a mechanic enum (e.g. "SIDE_QUEST").
 * Pure transformations — no hand-curated mapping.
 */
function generateCandidates(mechanic: string): string[] {
  const lower = mechanic.toLowerCase();
  const words = lower.split(/[_\s-]+/).filter(Boolean);
  if (words.length === 0) return [];

  const titleSpaced = words.map(titleWord).join(' '); // "Side Quest"
  const titleJoined = words.map(titleWord).join(''); // "SideQuest"
  const titleJoinedLower = titleWord(words.join('')); // "Sidequest"

  const out = new Set<string>([titleSpaced, titleJoined, titleJoinedLower]);

  // Drop common engine-only suffixes that don't appear on wiki pages.
  const SUFFIXES = ['Keyword', 'Piece', 'Effect'];
  for (const suf of SUFFIXES) {
    const re = new RegExp(`\\s+${suf}$`, 'i');
    if (re.test(titleSpaced)) out.add(titleSpaced.replace(re, ''));
  }

  // Drop trailing/leading filler words sometimes present in enums.
  const FILLER = ['Visual', 'Trigger'];
  for (const f of FILLER) {
    out.add(titleSpaced.replace(new RegExp(`\\b${f}\\b`, 'gi'), '').trim());
  }

  // Past-tense / adjective form → base form ("Enraged" → "Enrage").
  if (titleSpaced.endsWith('ed') && titleSpaced.length > 3) {
    out.add(titleSpaced.slice(0, -2)); // Enraged → Enrag
    out.add(titleSpaced.slice(0, -1)); // Enraged → Enrage
  }
  if (titleSpaced.endsWith('s') && titleSpaced.length > 3) {
    out.add(titleSpaced.slice(0, -1)); // plural → singular
  }

  return [...out].filter(Boolean);
}

/** Pull `extract` for a list of titles in batches, following redirects/normalize. */
async function fetchExtractsByTitles(
  titles: string[],
): Promise<{ map: Map<string, string>; redirects: Map<string, string>; normalized: Map<string, string> }> {
  const map = new Map<string, string>(); // canonical title -> extract
  const redirects = new Map<string, string>(); // requested -> resolved
  const normalized = new Map<string, string>(); // requested -> normalized

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

/** Strip wiki extract to a tight one-paragraph description. */
function cleanExtract(raw: string): string {
  const firstPara = raw.split(/\n\s*\n/)[0] ?? raw;
  return firstPara.replace(/\s+/g, ' ').trim();
}

/** Resolve a requested title through normalized + redirect maps. */
function resolveTitle(
  requested: string,
  normalized: Map<string, string>,
  redirects: Map<string, string>,
): string {
  let t = normalized.get(requested) ?? requested;
  // Redirects can chain; follow up to a few hops.
  for (let i = 0; i < 3 && redirects.has(t); i++) t = redirects.get(t)!;
  return t;
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
  const json = (await r.json()) as {
    query?: { search?: MwSearchResult[] };
  };
  const hit = json.query?.search?.[0];
  return hit?.title ?? null;
}

/**
 * Main entry point. Pass the list of mechanic enum values you actually have
 * on cards; returns a definition for every mechanic the wiki knows about.
 */
export async function loadKeywordMap(mechanics: Iterable<string>): Promise<KeywordMap> {
  const wanted = [...new Set(mechanics)];
  if (wanted.length === 0) return {};

  try {
    // 1. For each mechanic, generate candidate titles. Track which mechanic
    //    each candidate came from so we can pick the first hit per mechanic.
    const candidatesPerMechanic = new Map<string, string[]>();
    const allCandidates = new Set<string>();
    for (const m of wanted) {
      const cs = generateCandidates(m);
      candidatesPerMechanic.set(m, cs);
      for (const c of cs) allCandidates.add(c);
    }

    // 2. Batch fetch extracts (with redirect/normalize maps).
    const { map, redirects, normalized } = await fetchExtractsByTitles([
      ...allCandidates,
    ]);

    const result: KeywordMap = {};
    const stillMissing: string[] = [];
    for (const m of wanted) {
      let foundTitle: string | null = null;
      for (const cand of candidatesPerMechanic.get(m) ?? []) {
        const resolved = resolveTitle(cand, normalized, redirects);
        if (map.has(resolved)) {
          foundTitle = resolved;
          break;
        }
      }
      if (foundTitle) {
        result[m] = cleanExtract(map.get(foundTitle)!);
      } else {
        stillMissing.push(m);
      }
    }

    // 3. Search-API fallback for anything not yet matched.
    if (stillMissing.length > 0) {
      const searchTitles: string[] = [];
      const searchTitleByMechanic = new Map<string, string>();
      const searchResults = await Promise.all(
        stillMissing.map(async (m) => {
          // Use the title-spaced candidate as the search query — it's the
          // closest natural-language form of the enum.
          const q = generateCandidates(m)[0] ?? m;
          const top = await wikiSearchTop(q);
          return [m, top] as const;
        }),
      );
      for (const [m, t] of searchResults) {
        if (t) {
          searchTitleByMechanic.set(m, t);
          searchTitles.push(t);
        }
      }
      if (searchTitles.length > 0) {
        const second = await fetchExtractsByTitles(searchTitles);
        for (const [m, t] of searchTitleByMechanic) {
          const resolved = resolveTitle(t, second.normalized, second.redirects);
          const ex = second.map.get(resolved);
          if (ex) result[m] = cleanExtract(ex);
        }
      }
    }

    return result;
  } catch {
    return {};
  }
}
