import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as React from 'react';
import { fetchCollectibleCards } from './api';
import { buildIndex, query, type CardIndex } from './cardIndex';
import { CardGrid } from './CardGrid';
import { CLASSES, isStandard, isWild } from './cardUtils';
import { loadKeywordMap, type KeywordMap } from './keywordsApi';
import { ownedStore } from './ownedStore';
import type { GameMode, FormatFilter, OwnedMap } from './types';
import { useLocalStorage } from './useLocalStorage';

type Tab = 'all' | 'owned';

/** Tiny isolated counter — only this component re-renders on owned change. */
function OwnedCount({ render }: { render: (n: number) => React.ReactNode }) {
  const owned = useSyncExternalStore(
    ownedStore.subscribeSummary,
    ownedStore.getAll,
    ownedStore.getAll,
  );
  const n = useMemo(
    () => Object.values(owned).reduce((s, v) => s + (v || 0), 0),
    [owned],
  );
  return <>{render(n)}</>;
}

/** Action buttons whose disabled state depends on owned count.
 *  Isolated so the parent App doesn't re-render on every +/- click. */
function OwnedActions({
  loading,
  copied,
  onCopy,
  onDownload,
  onImport,
  onClear,
}: {
  loading: boolean;
  copied: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onImport: (file: File) => void;
  onClear: () => void;
}) {
  const owned = useSyncExternalStore(
    ownedStore.subscribeSummary,
    ownedStore.getAll,
    ownedStore.getAll,
  );
  const total = useMemo(
    () => Object.values(owned).reduce((s, v) => s + (v || 0), 0),
    [owned],
  );
  const empty = total === 0;
  return (
    <>
      <button className="btn" onClick={onCopy} disabled={loading || empty}>
        {copied ? '✓ Copied' : 'Copy Owned JSON'}
      </button>
      <button className="btn" onClick={onDownload} disabled={loading || empty}>
        Download
      </button>
      <label
        className={`btn cursor-pointer ${loading ? 'opacity-50 pointer-events-none' : ''}`}
      >
        Import
        <input
          type="file"
          accept="application/json,.json"
          className="hidden"
          disabled={loading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImport(f);
            e.target.value = '';
          }}
        />
      </label>
      <button className="btn-pink" onClick={onClear} disabled={loading || empty}>
        Clear
      </button>
    </>
  );
}

const COST_BUCKETS = [
  { label: '0' },
  { label: '1' },
  { label: '2' },
  { label: '3' },
  { label: '4' },
  { label: '5' },
  { label: '6' },
  { label: '7+' },
] as const;

function SkeletonCard() {
  return (
    <div className="panel p-2 flex flex-col gap-2 animate-pulse">
      <div className="aspect-[3/4] rounded bg-gradient-to-br from-cyber-panel2 to-cyber-bg/50 relative overflow-hidden">
        <div
          className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_infinite]"
          style={{
            background:
              'linear-gradient(90deg, transparent, rgba(0,240,255,0.08), transparent)',
          }}
        />
        <span className="absolute top-1 left-1 h-4 w-6 rounded-full bg-cyber-border/60" />
        <span className="absolute top-1 right-1 h-4 w-4 rounded-full bg-cyber-border/60" />
      </div>
      <div className="space-y-1">
        <div className="h-3 w-3/4 rounded bg-cyber-border/60" />
        <div className="h-2.5 w-1/2 rounded bg-cyber-border/40" />
      </div>
      <div className="flex items-center justify-between pt-1">
        <div className="h-2.5 w-8 rounded bg-cyber-border/40" />
        <div className="flex gap-1">
          <div className="h-5 w-7 rounded bg-cyber-border/40" />
          <div className="h-5 w-7 rounded bg-cyber-border/40" />
        </div>
      </div>
    </div>
  );
}

/** Floating scroll-to-top button. Appears after the user scrolls past 400px. */
function ScrollToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  if (!visible) return null;
  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Scroll to top"
      className="fixed bottom-6 right-6 z-50 h-12 w-12 rounded-full panel
                 flex items-center justify-center text-cyber-neon text-xl
                 border-cyber-neon/60 hover:border-cyber-neon
                 shadow-neon hover:scale-110 transition-all"
      style={{ backdropFilter: 'blur(6px)' }}
    >
      ↑
    </button>
  );
}

/** Debounce a value by `delay` ms (no extra deps). */
function useDebounced<T>(value: T, delay: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

export default function App() {
  const [index, setIndex] = useState<CardIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const loading = !index && !error;
  const cards = index?.sortedCards ?? null;

  // Filters
  const [gameMode, setGameMode] = useLocalStorage<GameMode>('flt.mode', 'CONSTRUCTED');
  const [formatF, setFormatF] = useLocalStorage<FormatFilter>('flt.format', 'BOTH');
  const [klass, setKlass] = useLocalStorage<string>('flt.class', 'ALL');
  const [cost, setCost] = useLocalStorage<string>('flt.cost', 'ALL');
  const [search, setSearch] = useLocalStorage<string>('flt.search', '');

  const [copied, setCopied] = useState(false);
  const [keywordMap, setKeywordMap] = useState<KeywordMap>({});

  useEffect(() => {
    fetchCollectibleCards()
      .then((raw) => setIndex(buildIndex(raw)))
      .catch((e) => setError(String(e)));
  }, []);

  // Load keyword glossary from the static file generated by GitHub Actions.
  // No wiki traffic at runtime — no rate limits, no CORS.
  useEffect(() => {
    let cancelled = false;
    loadKeywordMap().then((m) => {
      if (!cancelled) setKeywordMap(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const debouncedSearch = useDebounced(search, 200);

  /** Filtered list — uses inverted-index intersection + FlexSearch.
   *  Independent of `owned`, so +/- toggles never re-run this. */
  const baseFiltered = useMemo(() => {
    if (!index) return [];
    return query(index, {
      gameMode,
      formatF,
      klass,
      cost,
      search: debouncedSearch,
    });
  }, [index, gameMode, formatF, klass, cost, debouncedSearch]);

  /**
   * Ultra-compact export. The structure is:
   *   {
   *     $schema:  "ultra-v1",
   *     $cols:    [<column names in order>],
   *     $dict:    { cls: [...], typ: [...], ... } — enum values are emitted
   *               once and referenced by index inside each row.
   *     cards:    [[<row>], [<row>], ...]  — one positional array per card.
   *     keywords: { TAG: "definition", ... } — same dedupe as before.
   *   }
   *
   * Compared to the verbose object format this drops ~75-90% of bytes by
   *  - removing per-row keys (columnar instead),
   *  - factoring enums (class/type/rarity/race/spellSchool/format) into
   *    a top-level dictionary,
   *  - stripping useless fields (id, set, isMiniSet, elite, collectionText,
   *    multiClassGroup, default quantity etc.),
   *  - stripping HTML markers from rules text (<b>, [x] prefix, etc.).
   */
  const buildExportPayload = () => {
    if (!cards) return { $schema: 'ultra-v1', $cols: [], $dict: {}, cards: [], keywords: {} };
    const ownedMap = ownedStore.getAll();
    const ownedCards = cards.filter((c) => (ownedMap[String(c.dbfId)] ?? 0) > 0);

    // Enum dictionaries — built up while emitting rows. We record each
    // value's first index and reuse it.
    const dictMaker = () => {
      const arr: string[] = [];
      const idx = new Map<string, number>();
      const intern = (v: string | undefined | null): number | null => {
        if (v == null) return null;
        const got = idx.get(v);
        if (got !== undefined) return got;
        const i = arr.length;
        idx.set(v, i);
        arr.push(v);
        return i;
      };
      return { arr, intern };
    };

    const cls = dictMaker();
    const typ = dictMaker();
    const rar = dictMaker();
    const rce = dictMaker();
    const spl = dictMaker();
    const fmt = dictMaker();

    const stripText = (raw: string | undefined): string | null => {
      if (!raw) return null;
      return raw
        .replace(/<\/?b>/g, '')      // bold markers — keyword visibility
        .replace(/\[x\]/g, '')       // typesetting hint
        .replace(/\$/g, '')          // spell damage marker
        .replace(/#/g, '')           // healing marker
        .replace(/\s+/g, ' ')        // collapse whitespace
        .trim() || null;
    };

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const rows: any[][] = ownedCards.map((c) => {
      // Class: array of indices for multi-class, single index otherwise.
      let classCol: number | number[] | null = null;
      if (c.classes && c.classes.length > 1) {
        classCol = c.classes.map((x) => cls.intern(x)!);
      } else if (c.classes && c.classes.length === 1) {
        classCol = cls.intern(c.classes[0]);
      } else if (c.cardClass) {
        classCol = cls.intern(c.cardClass);
      }

      // Race: same idea.
      let raceCol: number | number[] | null = null;
      if (c.races && c.races.length > 1) {
        raceCol = c.races.map((x) => rce.intern(x)!);
      } else if (c.races && c.races.length === 1) {
        raceCol = rce.intern(c.races[0]);
      } else if (c.race) {
        raceCol = rce.intern(c.race);
      }

      const qty = ownedMap[String(c.dbfId)] ?? 0;
      const formatStr: 'STANDARD' | 'WILD' | 'OTHER' = isStandard(c)
        ? 'STANDARD'
        : isWild(c)
          ? 'WILD'
          : 'OTHER';
      const rune = c.runeCost
        ? [c.runeCost.blood, c.runeCost.frost, c.runeCost.unholy]
        : null;

      return [
        c.name,                          // n
        classCol,                         // cls
        c.cost ?? null,                   // cost
        c.attack ?? null,                 // atk
        c.health ?? null,                 // hp
        c.armor ?? null,                  // arm
        c.durability ?? null,             // dur
        typ.intern(c.type),               // typ
        rar.intern(c.rarity),             // rar
        raceCol,                          // race
        spl.intern(c.spellSchool),        // spl
        c.spellDamage ?? null,            // sd
        c.overload ?? null,               // ovl
        c.mechanics?.length ? c.mechanics : null,        // mech
        c.referencedTags?.length ? c.referencedTags : null, // ref
        stripText(c.text),                // txt
        rune,                             // rune (B,F,U) for DK
        fmt.intern(formatStr),            // fmt
        qty === 2 ? 2 : null,             // qty: omit when 1 (the default)
      ];
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */

    // Trim trailing nulls in each row (positional but we still need a header
    // so AI knows which fields were truncated — it only reads up to row.length).
    // Keep full length for predictability — the dictionary already gives us
    // the win, trailing nulls are cheap (`,null,null` ~ 10 chars per row).

    const usedTags = new Set<string>();
    for (const c of ownedCards) {
      if (c.mechanics) for (const m of c.mechanics) usedTags.add(m);
      if (c.referencedTags) for (const t of c.referencedTags) usedTags.add(t);
    }
    const keywords: Record<string, string> = {};
    for (const t of [...usedTags].sort()) {
      const def = keywordMap[t];
      if (def) keywords[t] = def;
    }

    return {
      $schema: 'ultra-v1',
      $cols: [
        'name',
        'class',     // index OR array of indices into $dict.cls
        'cost',
        'attack',
        'health',
        'armor',
        'durability',
        'type',      // index into $dict.typ
        'rarity',    // index into $dict.rar
        'race',      // index OR array of indices into $dict.rce
        'spellSchool', // index into $dict.spl
        'spellDamage',
        'overload',
        'mechanics',   // string[]
        'referencedTags', // string[]
        'text',
        'runeCost',  // [blood, frost, unholy] or null (Death Knight only)
        'format',    // index into $dict.fmt
        'quantity',  // null = 1 (default), 2 = two copies
      ],
      $dict: {
        class: cls.arr,
        type: typ.arr,
        rarity: rar.arr,
        race: rce.arr,
        spellSchool: spl.arr,
        format: fmt.arr,
      },
      cards: rows,
      keywords,
    };
  };

  const copyOwned = async () => {
    const payload = buildExportPayload();
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = JSON.stringify(payload, null, 2);
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const downloadJson = () => {
    const payload = buildExportPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hearthstone-collection-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File) => {
    try {
      const txt = await file.text();
      const parsed = JSON.parse(txt) as Array<{ dbfId: number; quantity: number }>;
      const next: OwnedMap = {};
      for (const it of parsed) {
        if (typeof it?.dbfId === 'number' && typeof it?.quantity === 'number' && it.quantity > 0) {
          next[String(it.dbfId)] = it.quantity;
        }
      }
      ownedStore.replace(next);
    } catch (e) {
      alert('Invalid JSON file: ' + e);
    }
  };

  const clearAll = () => {
    if (confirm('Clear your entire owned collection?')) ownedStore.replace({});
  };

  return (
    <div className="min-h-screen px-4 py-6 max-w-[1500px] mx-auto">
      <header className="mb-6">
        <h1
          className="font-display text-3xl md:text-4xl font-black tracking-widest uppercase"
          style={{
            background: 'linear-gradient(90deg,#00f0ff,#a855f7,#ff2bd6)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            textShadow: '0 0 22px rgba(0,240,255,0.25)',
          }}
        >
          Hearthstone · My Collectors
        </h1>
        <p className="text-cyber-mute text-sm mt-1">
          Track your owned cards, then copy a JSON snapshot for AI to draft you a deck.
        </p>
      </header>

      {/* Status bar */}
      <div className="panel p-3 mb-4 flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="pill bg-cyber-neon/10 text-cyber-neon border border-cyber-neon/40">
            <OwnedCount render={(n) => <>Owned cards: {n}</>} />
          </span>
          <span className="pill bg-cyber-pink/10 text-cyber-pink border border-cyber-pink/40">
            {loading ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-cyber-pink animate-ping" />
                Loading…
              </span>
            ) : (
              <>Filtered: {baseFiltered.length}</>
            )}
          </span>
          {cards && (
            <span className="pill bg-cyber-purple/10 text-cyber-purple border border-cyber-purple/40">
              Database: {cards.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <OwnedActions
            loading={loading}
            copied={copied}
            onCopy={copyOwned}
            onDownload={downloadJson}
            onImport={importJson}
            onClear={clearAll}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {(['all', 'owned'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            disabled={loading}
            className={`btn ${tab === t ? '!border-cyber-neon !text-cyber-neon shadow-neon' : ''}`}
          >
            {t === 'all' ? (
              'All Cards'
            ) : (
              <OwnedCount render={(n) => <>Owned ({n})</>} />
            )}
          </button>
        ))}
      </div>

      {/* Filters */}
      <fieldset
        disabled={loading}
        className={`panel p-3 mb-4 grid grid-cols-1 md:grid-cols-5 gap-3 ${
          loading ? 'opacity-60 cursor-not-allowed' : ''
        }`}
      >
        <label className="flex flex-col gap-1 text-xs uppercase text-cyber-mute tracking-wider">
          Game mode
          <select
            className="select"
            value={gameMode}
            onChange={(e) => setGameMode(e.target.value as GameMode)}
          >
            <option value="CONSTRUCTED">Constructed (Ranked)</option>
            <option value="BATTLEGROUNDS">Battlegrounds</option>
            <option value="MERCENARIES">Mercenaries</option>
            <option value="ALL">All cards</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs uppercase text-cyber-mute tracking-wider">
          Format
          <select
            className="select"
            value={formatF}
            onChange={(e) => setFormatF(e.target.value as FormatFilter)}
            disabled={loading || gameMode !== 'CONSTRUCTED'}
          >
            <option value="BOTH">Standard + Wild</option>
            <option value="STANDARD">Standard</option>
            <option value="WILD">Wild</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs uppercase text-cyber-mute tracking-wider">
          Class
          <select
            className="select"
            value={klass}
            onChange={(e) => setKlass(e.target.value)}
          >
            <option value="ALL">All classes</option>
            {CLASSES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs uppercase text-cyber-mute tracking-wider">
          Mana cost
          <select className="select" value={cost} onChange={(e) => setCost(e.target.value)}>
            <option value="ALL">Any</option>
            {COST_BUCKETS.map((b) => (
              <option key={b.label} value={b.label}>
                {b.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs uppercase text-cyber-mute tracking-wider">
          Search
          <input
            className="input"
            placeholder="name, text, mechanic…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </fieldset>

      {error && (
        <div className="panel p-4 text-cyber-pink">Failed to load cards: {error}</div>
      )}

      {loading && !error && (
        <>
          <div className="mb-3 text-center text-xs uppercase tracking-widest text-cyber-neon animate-glow">
            ▰▰▱▱ Syncing card database from HearthstoneJSON ▱▱▰▰
          </div>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: 18 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        </>
      )}

      {cards && !loading && (
        baseFiltered.length === 0 ? (
          <div className="panel p-8 text-center text-cyber-mute">
            No cards match these filters.
          </div>
        ) : (
          <CardGrid cards={baseFiltered} tab={tab} />
        )
      )}

      <ScrollToTop />

      <footer className="mt-8 text-center text-xs text-cyber-mute">
        Card data &copy; Blizzard Entertainment · Sourced from{' '}
        <a className="text-cyber-neon hover:underline" href="https://hearthstonejson.com/">
          HearthstoneJSON
        </a>
        . Not affiliated with Blizzard.
      </footer>
    </div>
  );
}
