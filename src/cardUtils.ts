import type { RawCard } from './types';

/** Sets currently in Standard rotation (as observed from HearthstoneJSON late 2025 / 2026).
 *  CORE is always Standard. The newest 2-year window of expansions is Standard. */
export const STANDARD_SETS: ReadonlySet<string> = new Set([
  'CORE',
  // Year of the Pegasus (2024)
  'WHIZBANGS_WORKSHOP',
  'ISLAND_VACATION', // Perils in Paradise
  'SPACE',           // The Great Dark Beyond
  // Year of the Raptor (2025)
  'EMERALD_DREAM',
  'THE_LOST_CITY',
  'TIME_TRAVEL',
]);

/** Sets that are not playable in any normal mode and should be hidden by default. */
const NON_PLAYABLE_SETS: ReadonlySet<string> = new Set([
  'HERO_SKINS',
  'VANILLA',
  'CHEAT', // safety
]);

/** Battlegrounds: trust dedicated fields, fall back to set-name prefix. */
export function isBattlegrounds(c: RawCard): boolean {
  if (c.techLevel != null) return true;
  if (c.battlegroundsAssociatedRaces && c.battlegroundsAssociatedRaces.length) return true;
  if (c.battlegroundsPremiumDbfId != null) return true;
  if (c.set && /^BATTLEGROUNDS/.test(c.set)) return true;
  return false;
}

/** Mercenaries: set names start with LETTUCE. */
export function isMercenaries(c: RawCard): boolean {
  return !!c.set && /^LETTUCE/.test(c.set);
}

export function isPlaceholder(c: RawCard): boolean {
  if (!c.set) return false;
  if (c.set.startsWith('PLACEHOLDER_')) return true;
  return NON_PLAYABLE_SETS.has(c.set);
}

export function isConstructed(c: RawCard): boolean {
  return !isBattlegrounds(c) && !isMercenaries(c) && !isPlaceholder(c);
}

export function isStandard(c: RawCard): boolean {
  return isConstructed(c) && !!c.set && STANDARD_SETS.has(c.set);
}

export function isWild(c: RawCard): boolean {
  return isConstructed(c) && !isStandard(c);
}

export const CLASSES = [
  'DEATHKNIGHT',
  'DEMONHUNTER',
  'DRUID',
  'HUNTER',
  'MAGE',
  'PALADIN',
  'PRIEST',
  'ROGUE',
  'SHAMAN',
  'WARLOCK',
  'WARRIOR',
  'NEUTRAL',
] as const;

export const CLASS_COLORS: Record<string, string> = {
  DEATHKNIGHT: '#3CC8E6',
  DEMONHUNTER: '#A330C9',
  DRUID: '#FF7C0A',
  HUNTER: '#AAD372',
  MAGE: '#3FC7EB',
  PALADIN: '#F48CBA',
  PRIEST: '#FFFFFF',
  ROGUE: '#FFF468',
  SHAMAN: '#0070DD',
  WARLOCK: '#8788EE',
  WARRIOR: '#C69B6D',
  NEUTRAL: '#9aa0b4',
};

export const RARITY_COLORS: Record<string, string> = {
  FREE: '#bcbcbc',
  COMMON: '#ffffff',
  RARE: '#0070dd',
  EPIC: '#a335ee',
  LEGENDARY: '#ff8000',
};

export function classesOf(c: RawCard): string[] {
  if (c.classes && c.classes.length) return c.classes;
  if (c.cardClass) return [c.cardClass];
  return ['NEUTRAL'];
}

export function maxQty(c: RawCard): 1 | 2 {
  return c.rarity === 'LEGENDARY' ? 1 : 2;
}

/** Set priority for picking a canonical reprint when the same card exists in
 *  multiple sets (e.g. CORE + LEGACY). Higher = preferred. */
function setRank(set?: string): number {
  if (!set) return 0;
  if (set === 'CORE') return 100;
  if (set === 'LEGACY') return 80;
  if (set === 'EXPERT1') return 70;
  return 10; // expansion sets — keep their own copy
}

/**
 * Hearthstone treats reprints of the same card across sets as a single deck
 * entry (max 2 copies total, regardless of how many printed versions exist).
 * The dataset, however, lists each printed version as its own entry.
 *
 * We deduplicate by (name, primary class). Within a duplicate group we keep
 * the canonical printing (prefer CORE, then LEGACY/EXPERT1, then expansions
 * picked deterministically by lowest dbfId).
 *
 * Returns:
 *   canonical: deduped card list to render.
 *   aliasOf:  map of every redundant dbfId -> canonical dbfId, used to migrate
 *             previously stored owned quantities.
 */
export function dedupeReprints(cards: RawCard[]): {
  canonical: RawCard[];
  aliasOf: Record<number, number>;
} {
  const groups = new Map<string, RawCard[]>();
  for (const c of cards) {
    const cls = (c.cardClass ?? (c.classes && c.classes[0]) ?? 'NEUTRAL') as string;
    const key = `${cls}::${c.name}`;
    const arr = groups.get(key);
    if (arr) arr.push(c);
    else groups.set(key, [c]);
  }

  const canonical: RawCard[] = [];
  const aliasOf: Record<number, number> = {};
  for (const arr of groups.values()) {
    if (arr.length === 1) {
      canonical.push(arr[0]);
      continue;
    }
    const sorted = [...arr].sort(
      (a, b) => setRank(b.set) - setRank(a.set) || a.dbfId - b.dbfId,
    );
    const winner = sorted[0];
    canonical.push(winner);
    for (const dup of sorted.slice(1)) {
      aliasOf[dup.dbfId] = winner.dbfId;
    }
  }
  return { canonical, aliasOf };
}
