/**
 * Fetches Hearthstone keyword definitions from the community wiki:
 *   https://hearthstone.wiki.gg/api.php
 *
 * Free, no auth, CORS open via `origin=*`. Cached in localStorage with a
 * 7-day TTL — call site doesn't have to think about freshness.
 *
 * Output keys are normalized to match HearthstoneJSON's `mechanics` enum
 * (e.g. "BATTLECRY", "DIVINE_SHIELD", "CHOOSE_ONE") so they can be looked
 * up directly from a card's `mechanics` array.
 */

const CACHE_KEY = 'kw.cache.v1';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const WIKI_ENDPOINT = 'https://hearthstone.wiki.gg/api.php';

export type KeywordMap = Record<string, string>;

interface CacheShape {
  fetchedAt: number;
  data: KeywordMap;
}

interface MwPage {
  pageid: number;
  ns: number;
  title: string;
  extract?: string;
}

interface MwResponse {
  query?: {
    pages?: Record<string, MwPage>;
  };
  continue?: { gcmcontinue?: string; continue?: string };
}

/** Convert wiki page title ("Divine Shield") to mechanics enum ("DIVINE_SHIELD"). */
function titleToMechanicKey(title: string): string {
  return title.trim().toUpperCase().replace(/[\s-]+/g, '_');
}

/** Trim wiki extract to a tight one- or two-sentence description. */
function cleanExtract(raw: string): string {
  // MediaWiki sometimes returns multi-paragraph extracts; first paragraph is plenty.
  const firstPara = raw.split(/\n\s*\n/)[0] ?? raw;
  // Collapse internal whitespace.
  return firstPara.replace(/\s+/g, ' ').trim();
}

async function fetchAllKeywords(): Promise<KeywordMap> {
  const map: KeywordMap = {};
  let cont: string | undefined;

  // Paginate just in case the category exceeds one batch (limit=500 is plenty
  // today, ~116 keywords, but future-proof anyway).
  for (let i = 0; i < 5; i++) {
    const url = new URL(WIKI_ENDPOINT);
    url.searchParams.set('action', 'query');
    url.searchParams.set('generator', 'categorymembers');
    url.searchParams.set('gcmtitle', 'Category:Keywords');
    url.searchParams.set('gcmlimit', '500');
    url.searchParams.set('prop', 'extracts');
    url.searchParams.set('exintro', '1');
    url.searchParams.set('explaintext', '1');
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    url.searchParams.set('origin', '*');
    if (cont) url.searchParams.set('gcmcontinue', cont);

    const r = await fetch(url.toString());
    if (!r.ok) throw new Error(`wiki ${r.status}`);
    const json = (await r.json()) as MwResponse & {
      query?: { pages?: MwPage[] };
    };

    // formatversion=2 returns pages as an array.
    const pages = (json.query?.pages ?? []) as MwPage[];
    for (const p of pages) {
      if (!p.title || !p.extract) continue;
      // Skip mode-specific subpages like "Battlegrounds/Battlecry" — we only
      // want canonical keyword pages whose title equals the keyword itself.
      if (p.title.includes('/')) continue;
      const key = titleToMechanicKey(p.title);
      const def = cleanExtract(p.extract);
      if (def) map[key] = def;
    }

    cont = json.continue?.gcmcontinue;
    if (!cont) break;
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
    const data = await fetchAllKeywords();
    if (Object.keys(data).length > 0) writeCache(data);
    return data;
  } catch {
    return {};
  }
}
