export type CardClass =
  | 'NEUTRAL'
  | 'DEMONHUNTER'
  | 'DRUID'
  | 'HUNTER'
  | 'MAGE'
  | 'PALADIN'
  | 'PRIEST'
  | 'ROGUE'
  | 'SHAMAN'
  | 'WARLOCK'
  | 'WARRIOR'
  | 'DEATHKNIGHT'
  | string;

export type CardRarity =
  | 'FREE'
  | 'COMMON'
  | 'RARE'
  | 'EPIC'
  | 'LEGENDARY'
  | string;

export type CardType =
  | 'MINION'
  | 'SPELL'
  | 'WEAPON'
  | 'HERO'
  | 'HERO_POWER'
  | 'LOCATION'
  | string;

/** Raw card from HearthstoneJSON `cards.collectible.json` */
export interface RawCard {
  id: string;
  dbfId: number;
  name: string;
  text?: string;
  flavor?: string;
  cardClass?: CardClass;
  classes?: CardClass[];
  multiClassGroup?: string;
  cost?: number;
  attack?: number;
  health?: number;
  durability?: number;
  armor?: number;
  rarity?: CardRarity;
  type?: CardType;
  set?: string;
  mechanics?: string[];
  referencedTags?: string[];
  collectible?: boolean;
  race?: string;
  races?: string[];
  spellSchool?: string;
  artist?: string;
  faction?: string;
  elite?: boolean;
  howToEarn?: string;
}

export type GameMode = 'CONSTRUCTED' | 'BATTLEGROUNDS' | 'MERCENARIES' | 'ALL';

export type FormatFilter = 'STANDARD' | 'WILD' | 'BOTH';

export interface OwnedMap {
  /** dbfId -> quantity (1 or 2 in HS) */
  [dbfId: string]: number;
}
