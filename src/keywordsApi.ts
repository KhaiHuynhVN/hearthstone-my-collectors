/**
 * Fetches Hearthstone keyword definitions from the community wiki:
 *   https://hearthstone.wiki.gg/api.php
 *
 * Free, no auth, CORS open via `origin=*`. Cached in localStorage with a
 * 7-day TTL — call site doesn't have to think about freshness.
 *
 * Two-phase fetch (a MediaWiki quirk):
 *   1) list=categorymembers — get keyword page titles.
 *   2) titles=...&prop=extracts — fetch extracts in batches of <=50.
 *      (Combining `prop=extracts` with `generator=categorymembers` returns
 *       only one extract per request even with `exlimit=max`.)
 */

const CACHE_KEY = 'kw.cache.v2';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const WIKI_ENDPOINT = 'https://hearthstone.wiki.gg/api.php';

/** Anonymous users may request at most 50 titles per query. */
const TITLE_BATCH = 50;

export type KeywordMap = Record<string, string>;

interface CacheShape {
  fetchedAt: number;
  data: KeywordMap;
}

interface MwTitlePage {
  title: string;
}

interface MwExtractPage {
  title: string;
  extract?: string;
}

/** Convert wiki page title ("Divine Shield") to mechanics enum ("DIVINE_SHIELD"). */
function titleToMechanicKey(title: string): string {
  return title.trim().toUpperCase().replace(/[\s-]+/g, '_');
}

/** Trim wiki extract to a tight one-paragraph description. */
function cleanExtract(raw: string): string {
  const firstPara = raw.split(/\n\s*\n/)[0] ?? raw;
  return firstPara.replace(/\s+/g, ' ').trim();
}

/** Phase 1 — list every page in Category:Keywords. */
async function fetchKeywordTitles(): Promise<string[]> {
  const titles: string[] = [];
  let cont: string | undefined;

  for (let i = 0; i < 6; i++) {
    const url = new URL(WIKI_ENDPOINT);
    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'categorymembers');
    url.searchParams.set('cmtitle', 'Category:Keywords');
    url.searchParams.set('cmlimit', 'max'); // 500 for anon
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    url.searchParams.set('origin', '*');
    if (cont) url.searchParams.set('cmcontinue', cont);

    const r = await fetch(url.toString());
    if (!r.ok) throw new Error(`wiki list ${r.status}`);
    const json = (await r.json()) as {
      query?: { categorymembers?: MwTitlePage[] };
      continue?: { cmcontinue?: string };
    };

    for (const m of json.query?.categorymembers ?? []) {
      // Skip subpages like "Battlegrounds/Battlecry" — keep canonical only.
      if (m.title && !m.title.includes('/')) titles.push(m.title);
    }
    cont = json.continue?.cmcontinue;
    if (!cont) break;
  }

  return titles;
}

/** Phase 2 — fetch intro extracts for a list of titles in batches. */
async function fetchExtracts(titles: string[]): Promise<KeywordMap> {
  const map: KeywordMap = {};

  for (let i = 0; i < titles.length; i += TITLE_BATCH) {
    const batch = titles.slice(i, i + TITLE_BATCH);
    const url = new URL(WIKI_ENDPOINT);
    url.searchParams.set('action', 'query');
    url.searchParams.set('titles', batch.join('|'));
    url.searchParams.set('prop', 'extracts');
    url.searchParams.set('exlimit', 'max');
    url.searchParams.set('exintro', '1');
    url.searchParams.set('explaintext', '1');
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    url.searchParams.set('origin', '*');

    const r = await fetch(url.toString());
    if (!r.ok) throw new Error(`wiki extracts ${r.status}`);
    const json = (await r.json()) as { query?: { pages?: MwExtractPage[] } };

    for (const p of json.query?.pages ?? []) {
      if (!p.title || !p.extract) continue;
      const key = titleToMechanicKey(p.title);
      const def = cleanExtract(p.extract);
      if (def) map[key] = def;
    }
  }

  return map;
}

function readCache(): KeywordMap | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheShape;
    if (
      !parsed ||
      typeof parsed.fetchedAt !== 'number' ||
      Date.now() - parsed.fetchedAt > CACHE_TTL_MS
    ) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache(data: KeywordMap): void {
  try {
    const payload: CacheShape = { fetchedAt: Date.now(), data };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* quota — ignore */
  }
}

/**
 * Get the keyword map, using cache if fresh.
 * Returns whatever is available — never throws (resolves with {} on failure).
 */
export async function loadKeywordMap(): Promise<KeywordMap> {
  const cached = readCache();
  if (cached) return cached;
  try {
    const titles = await fetchKeywordTitles();
    if (titles.length === 0) return {};
    const data = await fetchExtracts(titles);
    if (Object.keys(data).length > 0) writeCache(data);
    return data;
  } catch {
    return {};
  }
}
