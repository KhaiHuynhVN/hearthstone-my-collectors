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
