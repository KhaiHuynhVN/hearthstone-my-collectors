import type { RawCard } from './types';

/** Sets that are part of Standard rotation as of late 2025 / mid-2026.
 *  Anything else collectible & non-BG/non-Mercs => Wild. */
export const STANDARD_SETS: ReadonlySet<string> = new Set([
  'CORE',
  // Year of the Pegasus (2024) — still in Standard until next rotation
  'WHIZBANGS_WORKSHOP',
  'PERILS_IN_PARADISE',
  'THE_GREAT_DARK_BEYOND',
  // Year of the Raptor (2025)
  'EMERALD_DREAM',
  'INTO_THE_EMERALD_DREAM',
  'THE_LOST_CITY_OF_UNGORO',
]);

/** Battlegrounds sets — exclude from Constructed */
const BG_SET_PATTERNS = [/^BATTLEGROUNDS/];
/** Mercenaries sets */
const MERC_SET_PATTERNS = [/^LETTUCE/];

export function isBattlegrounds(c: RawCard): boolean {
  if (!c.set) return false;
  return BG_SET_PATTERNS.some((p) => p.test(c.set!));
}

export function isMercenaries(c: RawCard): boolean {
  if (!c.set) return false;
  return MERC_SET_PATTERNS.some((p) => p.test(c.set!));
}

export function isConstructed(c: RawCard): boolean {
  return !isBattlegrounds(c) && !isMercenaries(c);
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
