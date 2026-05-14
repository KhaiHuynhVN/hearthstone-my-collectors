import type { OwnedMap } from './types';

/**
 * External store for the user's owned-card quantities.
 *
 * Key insight: each card tile subscribes to ONLY its own dbfId. Toggling +/-
 * fires listeners for that one dbfId — every other tile is untouched, so
 * React doesn't reconcile 7000+ memoized components on every click.
 *
 * A separate "summary" channel is fired for aggregate listeners (e.g. the
 * total counter, the export array, the owned-tab filter).
 *
 * localStorage writes are throttled to the next idle frame so the click
 * itself never waits on JSON.stringify or storage I/O.
 */

const KEY = 'owned.v1';

type Listener = () => void;

let owned: OwnedMap = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as OwnedMap) : {};
  } catch {
    return {};
  }
})();

const perKey = new Map<number, Set<Listener>>();
const summary = new Set<Listener>();

let saveScheduled = false;
function scheduleSave() {
  if (saveScheduled) return;
  saveScheduled = true;
  const flush = () => {
    saveScheduled = false;
    try {
      localStorage.setItem(KEY, JSON.stringify(owned));
    } catch {
      /* quota — ignore */
    }
  };
  // Defer to idle so the click feels instant; fall back to setTimeout.
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(flush, { timeout: 500 });
  } else {
    setTimeout(flush, 0);
  }
}

export const ownedStore = {
  /** Read current quantity for a single card. */
  get(dbfId: number): number {
    return owned[String(dbfId)] ?? 0;
  },

  /** Read the full map (referentially stable until next mutation). */
  getAll(): OwnedMap {
    return owned;
  },

  /** Set quantity. Notifies the per-card and summary channels. */
  set(dbfId: number, q: number) {
    const cur = owned[String(dbfId)] ?? 0;
    if (cur === q) return;
    // New object so getAll() consumers see a referential change.
    const next: OwnedMap = { ...owned };
    if (q <= 0) delete next[String(dbfId)];
    else next[String(dbfId)] = q;
    owned = next;

    const subs = perKey.get(dbfId);
    if (subs) for (const l of subs) l();
    for (const l of summary) l();

    scheduleSave();
  },

  /** Replace entire map (used by Import / Clear). */
  replace(next: OwnedMap) {
    const prev = owned;
    owned = { ...next };

    // Notify any per-card subscriber whose value differs.
    const allKeys = new Set<string>([...Object.keys(prev), ...Object.keys(next)]);
    for (const k of allKeys) {
      const before = prev[k] ?? 0;
      const after = owned[k] ?? 0;
      if (before !== after) {
        const subs = perKey.get(Number(k));
        if (subs) for (const l of subs) l();
      }
    }
    for (const l of summary) l();
    scheduleSave();
  },

  subscribeKey(dbfId: number, l: Listener): () => void {
    let set = perKey.get(dbfId);
    if (!set) {
      set = new Set();
      perKey.set(dbfId, set);
    }
    set.add(l);
    return () => {
      set!.delete(l);
      if (set!.size === 0) perKey.delete(dbfId);
    };
  },

  subscribeSummary(l: Listener): () => void {
    summary.add(l);
    return () => summary.delete(l);
  },
};
