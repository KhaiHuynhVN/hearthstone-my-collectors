import type { RawCard } from './types';

/**
 * HearthstoneJSON: https://hearthstonejson.com/
 * Latest collectible cards in enUS.
 */
const COLLECTIBLE_URL =
  'https://api.hearthstonejson.com/v1/latest/enUS/cards.collectible.json';

/** All cards (including non-collectible) — used for BG/Mercs lookups if needed */
const ALL_URL =
  'https://api.hearthstonejson.com/v1/latest/enUS/cards.json';

export async function fetchCollectibleCards(): Promise<RawCard[]> {
  const r = await fetch(COLLECTIBLE_URL);
  if (!r.ok) throw new Error(`HearthstoneJSON ${r.status}`);
  const data = (await r.json()) as RawCard[];
  return data.filter((c) => c.collectible);
}

export async function fetchAllCards(): Promise<RawCard[]> {
  const r = await fetch(ALL_URL);
  if (!r.ok) throw new Error(`HearthstoneJSON ${r.status}`);
  return (await r.json()) as RawCard[];
}

/** Image URL (256px) from HearthstoneJSON CDN */
export function cardImageUrl(id: string): string {
  return `https://art.hearthstonejson.com/v1/render/latest/enUS/256x/${id}.png`;
}

/** Tile (small horizontal banner) — fast fallback */
export function cardTileUrl(id: string): string {
  return `https://art.hearthstonejson.com/v1/tiles/${id}.png`;
}
