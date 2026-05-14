#!/usr/bin/env node
/**
 * Build a static `public/keywords.json` glossary from hearthstone.wiki.gg.
 *
 * Runs in CI on a schedule (see .github/workflows/update-keywords.yml).
 * The browser app then loads this file from the same origin — no runtime
 * wiki traffic, no rate limits, no CORS surprises.
 *
 * Strategy (mirrors src/keywordsApi.ts but offline / no concurrency cap
 * concerns since this runs once every 6 hours, not on every page load):
 *   1. Fetch the full collectible card list from HearthstoneJSON.
 *   2. Collect the union of every `mechanics` + `referencedTags` value.
 *   3. For each tag, run a wiki full-text search to find the canonical
 *      page (handles plurals, redirects, tense automatically).
 *   4. Batch-fetch intro extracts for every unique top hit.
 *   5. Write `{ generatedAt, source, keywords }` to public/keywords.json.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HSJSON_URL = 'https://api.hearthstonejson.com/v1/latest/enUS/cards.collectible.json';
const WIKI_ENDPOINT = 'https://hearthstone.wiki.gg/api.php';
// Anonymous users may request up to 20 extracts per query (`exlimit=max`).
// Batching more titles than that silently drops the extras' extracts.
const TITLE_BATCH = 20;
const SEARCH_CONCURRENCY = 6;

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '..', 'public', 'keywords.json');

function mechanicToQuery(mechanic) {
  return mechanic.toLowerCase().replace(/_/g, ' ').trim();
}

function cleanExtract(raw) {
  const firstPara = raw.split(/\n\s*\n/)[0] ?? raw;
  return firstPara.replace(/\s+/g, ' ').trim();
}

async function getJson(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'hearthstone-my-collectors-bot/1.0' } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function wikiSearchTop(query) {
  const url = new URL(WIKI_ENDPOINT);
  url.searchParams.set('action', 'query');
  url.searchParams.set('list', 'search');
  url.searchParams.set('srsearch', query);
  url.searchParams.set('srnamespace', '0');
  url.searchParams.set('srlimit', '1');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  const json = await getJson(url.toString());
  return json.query?.search?.[0]?.title ?? null;
}

async function fetchExtractsByTitles(titles) {
  const map = new Map();
  const redirects = new Map();
  const normalized = new Map();

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
    const json = await getJson(url.toString());
    for (const n of json.query?.normalized ?? []) normalized.set(n.from, n.to);
    for (const rd of json.query?.redirects ?? []) redirects.set(rd.from, rd.to);
    for (const p of json.query?.pages ?? []) {
      if (p.missing || !p.title || !p.extract) continue;
      map.set(p.title, p.extract);
    }
  }
  return { map, redirects, normalized };
}

function resolveTitle(requested, normalized, redirects) {
  let t = normalized.get(requested) ?? requested;
  for (let i = 0; i < 3 && redirects.has(t); i++) t = redirects.get(t);
  return t;
}

async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  console.log('Fetching collectible cards from HearthstoneJSON…');
  const cards = await getJson(HSJSON_URL);

  const tagSet = new Set();
  for (const c of cards) {
    for (const m of c.mechanics ?? []) tagSet.add(m);
    for (const t of c.referencedTags ?? []) tagSet.add(t);
  }
  const tags = [...tagSet].sort();
  console.log(`Resolving ${tags.length} unique tags from wiki…`);

  const searchResults = await mapWithConcurrency(tags, SEARCH_CONCURRENCY, async (mechanic) => {
    try {
      const title = await wikiSearchTop(mechanicToQuery(mechanic));
      return { mechanic, title };
    } catch (e) {
      console.warn(`  search failed for ${mechanic}: ${e.message}`);
      return { mechanic, title: null };
    }
  });

  const titlesByMechanic = new Map();
  const uniqueTitles = [];
  for (const { mechanic, title } of searchResults) {
    if (!title) continue;
    titlesByMechanic.set(mechanic, title);
    if (!uniqueTitles.includes(title)) uniqueTitles.push(title);
  }
  console.log(`  ${uniqueTitles.length} unique wiki pages to fetch`);

  const { map, redirects, normalized } = await fetchExtractsByTitles(uniqueTitles);

  const keywords = {};
  for (const [mechanic, title] of titlesByMechanic) {
    const resolved = resolveTitle(title, normalized, redirects);
    const ex = map.get(resolved);
    if (ex) keywords[mechanic] = cleanExtract(ex);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'https://hearthstone.wiki.gg',
    cardSource: HSJSON_URL,
    totalTagsScanned: tags.length,
    totalKeywordsResolved: Object.keys(keywords).length,
    keywords,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${OUT_PATH} (${Object.keys(keywords).length} keywords)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
