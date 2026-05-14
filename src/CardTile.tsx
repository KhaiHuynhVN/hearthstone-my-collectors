import { memo, useCallback, useState, useSyncExternalStore } from 'react';
import { cardImageUrl, cardTileUrl } from './api';
import { CLASS_COLORS, RARITY_COLORS, classesOf, maxQty } from './cardUtils';
import { ownedStore } from './ownedStore';
import type { RawCard } from './types';

function classColor(cs: string[]): string {
  return CLASS_COLORS[cs[0]] ?? '#9aa0b4';
}

interface Props {
  card: RawCard;
}

function CardTileImpl({ card }: Props) {
  const dbfId = card.dbfId;

  // Per-card subscription: only this tile re-renders when its qty changes.
  const subscribe = useCallback(
    (cb: () => void) => ownedStore.subscribeKey(dbfId, cb),
    [dbfId],
  );
  const getSnapshot = useCallback(() => ownedStore.get(dbfId), [dbfId]);
  const qty = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const [imgOk, setImgOk] = useState(true);
  const cs = classesOf(card);
  const max = maxQty(card);

  return (
    <div
      className="cv-auto panel card-glow relative p-2 flex flex-col gap-2 transition-transform hover:-translate-y-0.5"
      style={{
        borderColor: qty > 0 ? '#00f0ff' : undefined,
        boxShadow:
          qty > 0
            ? '0 0 0 1px #00f0ff66, 0 0 18px #00f0ff33'
            : undefined,
      }}
    >
      <div className="relative aspect-[3/4] flex items-center justify-center bg-cyber-bg/60 rounded overflow-hidden">
        {imgOk ? (
          <img
            src={cardImageUrl(card.id)}
            loading="lazy"
            decoding="async"
            alt={card.name}
            className="max-w-full max-h-full"
            onError={() => setImgOk(false)}
          />
        ) : (
          <img
            src={cardTileUrl(card.id)}
            loading="lazy"
            decoding="async"
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
            onClick={() => ownedStore.set(dbfId, Math.max(0, qty - 1))}
          >
            −
          </button>
          <button
            className="btn-pink !px-2 !py-0.5 !text-xs"
            disabled={qty >= max}
            onClick={() => ownedStore.set(dbfId, Math.min(max, qty + 1))}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

/** Memo on card identity only — qty is read from the store. */
export const CardTile = memo(CardTileImpl, (a, b) => a.card.dbfId === b.card.dbfId);
