/**
 * Fetches Hearthstone keyword definitions from the community wiki:
 *   https://hearthstone.wiki.gg/api.php
 *
 * Free, no auth, CORS open via `origin=*`. NO local caching — always fetch
 * fresh so the user gets the latest definitions on every page load.
 *
 * Two-phase fetch (a MediaWiki quirk):
 *   1) list=categorymembers — get keyword page titles.
 *   2) titles=...&prop=extracts — fetch extracts in batches of <=50.
 *      (Combining `prop=extracts` with `generator=categorymembers` returns
 *       only one extract per request even with `exlimit=max`.)
 */

const WIKI_ENDPOINT = 'https://hearthstone.wiki.gg/api.php';

/** Anonymous users may request at most 50 titles per query. */
const TITLE_BATCH = 50;

export type KeywordMap = Record<string, string>;

interface MwTitlePage {
  title: string;
}

interface MwExtractPage {
  title: string;
  extract?: string;
}

/**
 * Convert wiki page title to mechanics enum form. Mechanics from
 * HearthstoneJSON look like "BATTLECRY", "DIVINE_SHIELD", "CHOOSE_ONE",
 * "QUEST". Wiki titles can be "Battlecry", "Divine Shield",
 * "Quest (ability)", "Mega-Windfury".
 */
function titleToMechanicKey(title: string): string {
  return title
    .replace(/\s*\([^)]*\)\s*/g, ' ') // strip "(ability)" disambiguators
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

/** Trim wiki extract to a tight one-paragraph description. */
function cleanExtract(raw: string): string {
  const firstPara = raw.split(/\n\s*\n/)[0] ?? raw;
  return firstPara.replace(/\s+/g, ' ').trim();
}

/** Wiki categories that together cover every keyword card text uses.
 *  - Keywords: expansion-specific (Dredge, Excavate, ...)
 *  - Evergreen keywords: Battlecry, Deathrattle, Taunt, Freeze, ...
 *  - Abilities: lower-level mechanics (Enrage, Spell damage, ...) */
const KEYWORD_CATEGORIES = [
  'Category:Keywords',
  'Category:Evergreen keywords',
  'Category:Abilities',
] as const;

/** Phase 1 — list every page across all keyword categories. */
async function fetchKeywordTitles(): Promise<string[]> {
  const seen = new Set<string>();

  for (const category of KEYWORD_CATEGORIES) {
    let cont: string | undefined;
    for (let i = 0; i < 6; i++) {
      const url = new URL(WIKI_ENDPOINT);
      url.searchParams.set('action', 'query');
      url.searchParams.set('list', 'categorymembers');
      url.searchParams.set('cmtitle', category);
      url.searchParams.set('cmlimit', 'max');
      url.searchParams.set('cmnamespace', '0');
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
        if (m.title && !m.title.includes('/')) seen.add(m.title);
      }
      cont = json.continue?.cmcontinue;
      if (!cont) break;
    }
  }

  return [...seen];
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

/**
 * Fetch the keyword map fresh from the wiki on every call.
 * Returns whatever is available — never throws (resolves with {} on failure).
 */
export async function loadKeywordMap(): Promise<KeywordMap> {
  try {
    const titles = await fetchKeywordTitles();
    if (titles.length === 0) return {};
    return await fetchExtracts(titles);
  } catch {
    return {};
  }
}
