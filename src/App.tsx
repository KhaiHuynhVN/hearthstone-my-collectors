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

  // Load keyword glossary AFTER cards are loaded (so we know which mechanics
  // actually appear) — non-blocking. Failure is silent: the export simply
  // omits `keywordDefinitions` rather than break.
  useEffect(() => {
    if (!cards) return;
    let cancelled = false;
    const mechanics = new Set<string>();
    for (const c of cards) {
      if (c.mechanics) for (const m of c.mechanics) mechanics.add(m);
    }
    loadKeywordMap(mechanics).then((m) => {
      if (!cancelled) setKeywordMap(m);
    });
    return () => {
      cancelled = true;
    };
  }, [cards]);

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

  const buildExportArray = () => {
    if (!cards) return [];
    const map = ownedStore.getAll();
    return cards
      .filter((c) => (map[String(c.dbfId)] ?? 0) > 0)
      .map((c) => {
        const mechanics = c.mechanics;
        let keywordDefinitions: Record<string, string> | undefined;
        if (mechanics && mechanics.length && Object.keys(keywordMap).length) {
          const defs: Record<string, string> = {};
          for (const m of mechanics) {
            const def = keywordMap[m];
            if (def) defs[m] = def;
          }
          if (Object.keys(defs).length) keywordDefinitions = defs;
        }
        return {
          dbfId: c.dbfId,
          id: c.id,
          name: c.name,
          cardClass: c.cardClass,
          classes: c.classes,
          multiClassGroup: c.multiClassGroup,
          cost: c.cost,
          attack: c.attack,
          health: c.health,
          durability: c.durability,
          armor: c.armor,
          type: c.type,
          rarity: c.rarity,
          race: c.race,
          races: c.races,
          spellSchool: c.spellSchool,
          spellDamage: c.spellDamage,
          overload: c.overload,
          runeCost: c.runeCost,
          set: c.set,
          format: isStandard(c) ? 'STANDARD' : isWild(c) ? 'WILD' : 'OTHER',
          mechanics,
          keywordDefinitions,
          referencedTags: c.referencedTags,
          text: c.text,
          collectionText: c.collectionText,
          elite: c.elite,
          isMiniSet: c.isMiniSet,
          quantity: map[String(c.dbfId)] ?? 0,
        };
      });
  };

  const copyOwned = async () => {
    const arr = buildExportArray();
    try {
      await navigator.clipboard.writeText(JSON.stringify(arr, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = JSON.stringify(arr, null, 2);
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const downloadJson = () => {
    const arr = buildExportArray();
    const blob = new Blob([JSON.stringify(arr, null, 2)], { type: 'application/json' });
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
