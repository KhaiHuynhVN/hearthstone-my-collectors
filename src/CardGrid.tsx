import { forwardRef, memo, useMemo, useSyncExternalStore } from 'react';
import { VirtuosoGrid, type GridComponents } from 'react-virtuoso';
import { CardTile } from './CardTile';
import { ownedStore } from './ownedStore';
import type { RawCard } from './types';

/**
 * IMPORTANT: defined outside any render function. If we inline these inside a
 * component, Virtuoso would remount the whole grid on every parent render.
 */
/**
 * Layout strategy: flex-wrap on List + responsive % width on Item.
 * Virtuoso measures one Item's width vs the List width to compute itemsPerRow,
 * so Item MUST have a measurable own width (no display:contents, no grid cells).
 * Padding on Item creates the visual gap.
 */
const gridComponents: GridComponents = {
  List: forwardRef<HTMLDivElement, { style?: React.CSSProperties; children?: React.ReactNode }>(
    function VList({ style, children, ...rest }, ref) {
      return (
        <div
          ref={ref}
          {...rest}
          style={{ display: 'flex', flexWrap: 'wrap', ...style }}
        >
          {children}
        </div>
      );
    },
  ),
  Item: ({ children, ...rest }) => (
    <div
      {...rest}
      className="w-1/2 sm:w-1/3 md:w-1/4 lg:w-1/5 xl:w-1/6 p-1.5 box-border flex"
    >
      <div className="w-full">{children}</div>
    </div>
  ),
};

interface Props {
  cards: RawCard[];
  tab: 'all' | 'owned';
}

/**
 * Virtualized grid that renders only the cards currently in the viewport.
 * Uses window scrolling (the page itself scrolls) so the page header / filters
 * stay above the grid as before.
 */
export const CardGrid = memo(function CardGrid({ cards, tab }: Props) {
  return tab === 'owned' ? <OwnedVirtualGrid cards={cards} /> : <AllVirtualGrid cards={cards} />;
});

function AllVirtualGrid({ cards }: { cards: RawCard[] }) {
  return (
    <VirtuosoGrid
      useWindowScroll
      data={cards}
      computeItemKey={(_, c) => c.id}
      components={gridComponents}
      itemContent={(_index, card) => <CardTile card={card} />}
      overscan={400}
      increaseViewportBy={400}
    />
  );
}

function OwnedVirtualGrid({ cards }: { cards: RawCard[] }) {
  const owned = useSyncExternalStore(
    ownedStore.subscribeSummary,
    ownedStore.getAll,
    ownedStore.getAll,
  );
  const visible = useMemo(
    () => cards.filter((c) => (owned[String(c.dbfId)] ?? 0) > 0),
    [cards, owned],
  );
  if (visible.length === 0) {
    return (
      <div className="panel p-8 text-center text-cyber-mute">
        You haven't marked any owned cards yet.
      </div>
    );
  }
  return (
    <VirtuosoGrid
      useWindowScroll
      data={visible}
      computeItemKey={(_, c) => c.id}
      components={gridComponents}
      itemContent={(_index, card) => <CardTile card={card} />}
      overscan={400}
      increaseViewportBy={400}
    />
  );
}
