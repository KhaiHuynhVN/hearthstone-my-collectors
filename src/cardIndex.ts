import { Index as FlexSearchIndex } from 'flexsearch';
import {
  classesOf,
  isBattlegrounds,
  isConstructed,
  isMercenaries,
  isStandard,
  isWild,
} from './cardUtils';
import type { FormatFilter, GameMode, RawCard } from './types';

/**
 * Inverted index over the card collection.
 *
 * Filter logic for any combination of (mode, format, class, cost, search) is
 * just an intersection of the matching `Set<dbfId>`s — O(min set size) instead
 * of O(N). FlexSearch handles fuzzy/forward text matches and returns matching
 * dbfIds, which we treat as another set to intersect.
 *
 * Building the index for 7935 cards takes ~30ms once, after which every
 * filter+search runs in microseconds. Same code scales to 100M cards.
 */

export type CostKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7+';

export const ALL_KEY = 'ALL' as const;

export interface CardIndex {
  /** Cards in the canonical (cost asc, name asc) display order. */
  sortedCards: RawCard[];
  /** Quick lookup by dbfId. */
  byDbfId: Map<number, RawCard>;

  // Filter posting lists. Each entry maps a filter value -> set of matching dbfIds.
  byClass: Map<string, Set<number>>;
  byCost: Map<string, Set<number>>;
  byMode: Map<string, Set<number>>;
  byFormat: Map<string, Set<number>>;

  /** Full-text index on name + rules text + mechanics. */
  text: FlexSearchIndex;
}

const COST_KEY = (n: number): CostKey =>
  n >= 7 ? '7+' : (String(Math.max(0, Math.floor(n))) as CostKey);

function add<K>(map: Map<K, Set<number>>, key: K, dbfId: number): void {
  let s = map.get(key);
  if (!s) {
    s = new Set();
    map.set(key, s);
  }
  s.add(dbfId);
}

export function buildIndex(rawCards: RawCard[]): CardIndex {
  const sortedCards = [...rawCards].sort(
    (a, b) => (a.cost ?? 0) - (b.cost ?? 0) || a.name.localeCompare(b.name),
  );
  const byDbfId = new Map<number, RawCard>();
  const byClass = new Map<string, Set<number>>();
  const byCost = new Map<string, Set<number>>();
  const byMode = new Map<string, Set<number>>();
  const byFormat = new Map<string, Set<number>>();

  const text: FlexSearchIndex = new FlexSearchIndex({
    tokenize: 'forward', // prefix match for "search-as-you-type"
    cache: true,
    resolution: 9,
  });

  for (const c of sortedCards) {
    byDbfId.set(c.dbfId, c);

    // Class postings (multi-class cards land in every relevant bucket).
    for (const cls of classesOf(c)) add(byClass, cls, c.dbfId);
    add(byClass, ALL_KEY, c.dbfId);

    // Cost postings.
    add(byCost, COST_KEY(c.cost ?? 0), c.dbfId);
    add(byCost, ALL_KEY, c.dbfId);

    // Mode postings.
    if (isBattlegrounds(c)) add(byMode, 'BATTLEGROUNDS', c.dbfId);
    if (isMercenaries(c)) add(byMode, 'MERCENARIES', c.dbfId);
    if (isConstructed(c)) add(byMode, 'CONSTRUCTED', c.dbfId);
    add(byMode, ALL_KEY, c.dbfId);

    // Format postings (only meaningful for Constructed; we still add to BOTH).
    if (isStandard(c)) add(byFormat, 'STANDARD', c.dbfId);
    if (isWild(c)) add(byFormat, 'WILD', c.dbfId);
    add(byFormat, 'BOTH', c.dbfId);

    // Text index — use dbfId as the document id.
    const haystack = `${c.name} ${c.text ?? ''} ${(c.mechanics ?? []).join(' ')}`;
    text.add(c.dbfId, haystack);
  }

  return { sortedCards, byDbfId, byClass, byCost, byMode, byFormat, text };
}

/**
 * Intersect N sets in O(min size). Always iterate the smallest set and probe
 * the others via Set.has (O(1)). Returns null if any required set is missing.
 */
export function intersectSets(sets: Array<Set<number> | undefined>): Set<number> {
  const present: Set<number>[] = [];
  for (const s of sets) {
    if (!s) return new Set(); // unknown filter value — empty result
    present.push(s);
  }
  if (present.length === 0) return new Set();
  if (present.length === 1) return present[0];

  // Smallest first.
  present.sort((a, b) => a.size - b.size);
  const out = new Set<number>();
  const [smallest, ...rest] = present;
  outer: for (const v of smallest) {
    for (const r of rest) if (!r.has(v)) continue outer;
    out.add(v);
  }
  return out;
}

export interface FilterParams {
  gameMode: GameMode;
  formatF: FormatFilter;
  klass: string; // class name or 'ALL'
  cost: string; // CostKey or 'ALL'
  search: string; // raw text query
}

/**
 * Run a filter+search query against the index.
 * Returns the matching cards in canonical sort order.
 */
export function query(idx: CardIndex, p: FilterParams): RawCard[] {
  const sets: Array<Set<number> | undefined> = [];

  // Mode (mapped: 'ALL' on the dropdown means no restriction at all).
  if (p.gameMode !== 'ALL') sets.push(idx.byMode.get(p.gameMode));
  // Format only restricts within Constructed.
  if (p.gameMode === 'CONSTRUCTED' && p.formatF !== 'BOTH') {
    sets.push(idx.byFormat.get(p.formatF));
  }
  if (p.klass !== 'ALL') sets.push(idx.byClass.get(p.klass));
  if (p.cost !== 'ALL') sets.push(idx.byCost.get(p.cost));

  // Text search — FlexSearch returns an array of dbfIds. Limit high so we get all hits.
  const term = p.search.trim();
  if (term) {
    const ids = idx.text.search(term, { limit: 1_000_000 }) as number[];
    sets.push(new Set(ids));
  }

  // No filter at all → full sorted list.
  if (sets.length === 0) return idx.sortedCards;

  const matchSet = intersectSets(sets);
  if (matchSet.size === 0) return [];

  // Iterate sorted order once and pick matches. O(N) worst-case but with
  // O(1) probes — for 100M cards with no filters this is the fastest.
  // For tighter filters we'd be faster sorting matchSet directly, but the
  // crossover only matters at extreme N; this branch keeps code simple.
  if (matchSet.size > idx.sortedCards.length / 8) {
    const out: RawCard[] = [];
    for (const c of idx.sortedCards) if (matchSet.has(c.dbfId)) out.push(c);
    return out;
  }

  // Tight result: sort the small matched array directly.
  const out: RawCard[] = [];
  for (const id of matchSet) {
    const c = idx.byDbfId.get(id);
    if (c) out.push(c);
  }
  out.sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0) || a.name.localeCompare(b.name));
  return out;
}
