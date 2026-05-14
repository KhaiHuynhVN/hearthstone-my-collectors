import { useEffect, useMemo, useState } from 'react';
import { fetchCollectibleCards, cardImageUrl, cardTileUrl } from './api';
import {
  CLASSES,
  CLASS_COLORS,
  RARITY_COLORS,
  classesOf,
  dedupeReprints,
  isBattlegrounds,
  isConstructed,
  isMercenaries,
  isStandard,
  isWild,
  maxQty,
} from './cardUtils';
import type { GameMode, FormatFilter, OwnedMap, RawCard } from './types';
import { useLocalStorage } from './useLocalStorage';

type Tab = 'all' | 'owned';

const COST_BUCKETS = [
  { label: '0', test: (n: number) => n === 0 },
  { label: '1', test: (n: number) => n === 1 },
  { label: '2', test: (n: number) => n === 2 },
  { label: '3', test: (n: number) => n === 3 },
  { label: '4', test: (n: number) => n === 4 },
  { label: '5', test: (n: number) => n === 5 },
  { label: '6', test: (n: number) => n === 6 },
  { label: '7+', test: (n: number) => n >= 7 },
] as const;

function classColor(cs: string[]): string {
  return CLASS_COLORS[cs[0]] ?? '#9aa0b4';
}

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

function CardTile({
  card,
  qty,
  onChange,
}: {
  card: RawCard;
  qty: number;
  onChange: (q: number) => void;
}) {
  const [imgOk, setImgOk] = useState(true);
  const cs = classesOf(card);
  const max = maxQty(card);

  return (
    <div
      className="panel card-glow relative p-2 flex flex-col gap-2 transition-transform hover:-translate-y-0.5"
      style={{ borderColor: qty > 0 ? '#00f0ff' : undefined, boxShadow: qty > 0 ? '0 0 0 1px #00f0ff66, 0 0 18px #00f0ff33' : undefined }}
    >
      <div className="relative aspect-[3/4] flex items-center justify-center bg-cyber-bg/60 rounded overflow-hidden">
        {imgOk ? (
          <img
            src={cardImageUrl(card.id)}
            loading="lazy"
            alt={card.name}
            className="max-w-full max-h-full"
            onError={() => setImgOk(false)}
          />
        ) : (
          <img
            src={cardTileUrl(card.id)}
            loading="lazy"
            alt={card.name}
            className="w-full"
          />
        )}
        <span
          className="absolute top-1 left-1 pill"
          style={{
            background: '#0d0d22cc',
            color: '#fff',
            border: '1px solid #00f0ff80',
          }}
        >
          {card.cost ?? 0}
        </span>
        <span
          className="absolute top-1 right-1 pill"
          style={{
            background: '#0d0d22cc',
            color: RARITY_COLORS[card.rarity ?? 'COMMON'] ?? '#fff',
            border: `1px solid ${RARITY_COLORS[card.rarity ?? 'COMMON'] ?? '#fff'}80`,
          }}
        >
          {(card.rarity ?? '').slice(0, 1)}
        </span>
      </div>
      <div className="text-xs">
        <div
          className="font-display font-bold truncate"
          title={card.name}
          style={{ color: classColor(cs) }}
        >
          {card.name}
        </div>
        <div className="text-cyber-mute truncate">
          {cs.join(' / ')} • {card.type}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-cyber-mute">
          {qty}/{max}
        </span>
        <div className="flex gap-1">
          <button
            className="btn !px-2 !py-0.5 !text-xs"
            disabled={qty <= 0}
            onClick={() => onChange(Math.max(0, qty - 1))}
          >
            −
          </button>
          <button
            className="btn-pink !px-2 !py-0.5 !text-xs"
            disabled={qty >= max}
            onClick={() => onChange(Math.min(max, qty + 1))}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [cards, setCards] = useState<RawCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const loading = !cards && !error;

  // Filters
  const [gameMode, setGameMode] = useLocalStorage<GameMode>('flt.mode', 'CONSTRUCTED');
  const [formatF, setFormatF] = useLocalStorage<FormatFilter>('flt.format', 'BOTH');
  const [klass, setKlass] = useLocalStorage<string>('flt.class', 'ALL');
  const [cost, setCost] = useLocalStorage<string>('flt.cost', 'ALL');
  const [search, setSearch] = useLocalStorage<string>('flt.search', '');

  // Collection
  const [owned, setOwned] = useLocalStorage<OwnedMap>('owned.v1', {});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchCollectibleCards()
      .then((raw) => {
        const { canonical, aliasOf } = dedupeReprints(raw);
        // Migrate localStorage entries pointing at deduped reprints onto canonical.
        setOwned((prev) => {
          let mutated = false;
          const next: OwnedMap = {};
          for (const [dbfStr, qty] of Object.entries(prev)) {
            const dbf = Number(dbfStr);
            const target = aliasOf[dbf] ?? dbf;
            if (target !== dbf) mutated = true;
            const cap = canonical.find((c) => c.dbfId === target);
            const max = cap ? maxQty(cap) : 2;
            const merged = Math.min(max, (next[String(target)] ?? 0) + qty);
            next[String(target)] = merged;
          }
          return mutated ? next : prev;
        });
        setCards(
          [...canonical].sort(
            (a, b) =>
              (a.cost ?? 0) - (b.cost ?? 0) || a.name.localeCompare(b.name),
          ),
        );
      })
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!cards) return [];
    const term = search.trim().toLowerCase();

    return cards.filter((c) => {
      // Game mode
      if (gameMode === 'CONSTRUCTED') {
        if (!isConstructed(c)) return false;
      } else if (gameMode === 'BATTLEGROUNDS') {
        if (!isBattlegrounds(c)) return false;
      } else if (gameMode === 'MERCENARIES') {
        if (!isMercenaries(c)) return false;
      }
      // ALL: no filtering by mode

      // Format (only meaningful for Constructed)
      if (gameMode === 'CONSTRUCTED' && formatF !== 'BOTH') {
        if (formatF === 'STANDARD' && !isStandard(c)) return false;
        if (formatF === 'WILD' && !isWild(c)) return false;
      }

      // Class
      if (klass !== 'ALL') {
        const cs = classesOf(c);
        if (!cs.includes(klass)) return false;
      }

      // Cost
      if (cost !== 'ALL') {
        const bucket = COST_BUCKETS.find((b) => b.label === cost);
        if (bucket && !bucket.test(c.cost ?? 0)) return false;
      }

      // Search
      if (term) {
        const hay = `${c.name} ${c.text ?? ''} ${(c.mechanics ?? []).join(' ')}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }

      // Owned tab
      if (tab === 'owned') {
        if ((owned[String(c.dbfId)] ?? 0) <= 0) return false;
      }

      return true;
    });
  }, [cards, gameMode, formatF, klass, cost, search, tab, owned]);

  const totalOwned = useMemo(
    () => Object.values(owned).reduce((s, v) => s + (v || 0), 0),
    [owned],
  );

  const setQty = (dbfId: number, q: number) => {
    setOwned((prev) => {
      const next = { ...prev };
      if (q <= 0) delete next[String(dbfId)];
      else next[String(dbfId)] = q;
      return next;
    });
  };

  const buildExportArray = () => {
    if (!cards) return [];
    return cards
      .filter((c) => (owned[String(c.dbfId)] ?? 0) > 0)
      .map((c) => ({
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
        mechanics: c.mechanics,
        referencedTags: c.referencedTags,
        text: c.text,
        collectionText: c.collectionText,
        elite: c.elite,
        isMiniSet: c.isMiniSet,
        quantity: owned[String(c.dbfId)] ?? 0,
      }));
  };

  const copyOwned = async () => {
    const arr = buildExportArray();
    try {
      await navigator.clipboard.writeText(JSON.stringify(arr, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback
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
      setOwned(next);
    } catch (e) {
      alert('Invalid JSON file: ' + e);
    }
  };

  const clearAll = () => {
    if (confirm('Clear your entire owned collection?')) setOwned({});
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
            Owned cards: {totalOwned}
          </span>
          <span className="pill bg-cyber-pink/10 text-cyber-pink border border-cyber-pink/40">
            {loading ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-cyber-pink animate-ping" />
                Loading…
              </span>
            ) : (
              <>Showing: {filtered.length}</>
            )}
          </span>
          {cards && (
            <span className="pill bg-cyber-purple/10 text-cyber-purple border border-cyber-purple/40">
              Database: {cards.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="btn"
            onClick={copyOwned}
            disabled={loading || totalOwned === 0}
          >
            {copied ? '✓ Copied' : 'Copy Owned JSON'}
          </button>
          <button
            className="btn"
            onClick={downloadJson}
            disabled={loading || totalOwned === 0}
          >
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
                if (f) void importJson(f);
                e.target.value = '';
              }}
            />
          </label>
          <button
            className="btn-pink"
            onClick={clearAll}
            disabled={loading || totalOwned === 0}
          >
            Clear
          </button>
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
            {t === 'all' ? 'All Cards' : `Owned (${totalOwned})`}
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

      {/* Body */}
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
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {filtered.map((c) => (
            <CardTile
              key={c.id}
              card={c}
              qty={owned[String(c.dbfId)] ?? 0}
              onChange={(q) => setQty(c.dbfId, q)}
            />
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full panel p-8 text-center text-cyber-mute">
              No cards match these filters.
            </div>
          )}
        </div>
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
