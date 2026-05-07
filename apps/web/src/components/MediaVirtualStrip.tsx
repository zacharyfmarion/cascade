import React, { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

interface MediaVirtualStripProps {
  count: number;
  itemSize: number;
  height: number;
  overscan?: number;
  activeIndex?: number;
  ariaLabel: string;
  className?: string;
  style?: React.CSSProperties;
  onVisibleIndexesChange?: (indexes: number[]) => void;
  renderItem: (index: number) => React.ReactNode;
}

export const MediaVirtualStrip: React.FC<MediaVirtualStripProps> = ({
  count,
  itemSize,
  height,
  overscan = 3,
  activeIndex,
  ariaLabel,
  className = '',
  style,
  onVisibleIndexesChange,
  renderItem,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const lastVisibleKeyRef = useRef('');
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemSize,
    horizontal: true,
    overscan,
    getItemKey: index => index,
    useFlushSync: false,
  });

  useEffect(() => {
    if (activeIndex === undefined || activeIndex < 0 || activeIndex >= count) return;
    virtualizer.scrollToIndex(activeIndex, { align: 'center' });
  }, [activeIndex, count, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();

  useEffect(() => {
    if (!onVisibleIndexesChange) return;
    const indexes = virtualItems.map(item => item.index);
    const key = indexes.join(',');
    if (key === lastVisibleKeyRef.current) return;
    lastVisibleKeyRef.current = key;
    onVisibleIndexesChange(indexes);
  }, [onVisibleIndexesChange, virtualItems]);

  return (
    <div
      ref={parentRef}
      className={`media-virtual-strip ${className}`.trim()}
      role="listbox"
      aria-label={ariaLabel}
      style={{
        ...style,
        height,
        overflowX: 'auto',
        overflowY: 'hidden',
        position: 'relative',
      }}
    >
      <div
        style={{
          height: '100%',
          position: 'relative',
          width: virtualizer.getTotalSize(),
        }}
      >
        {virtualItems.map(item => (
          <div
            key={item.key}
            data-index={item.index}
            role="option"
            aria-selected={item.index === activeIndex}
            style={{
              height: '100%',
              left: 0,
              position: 'absolute',
              top: 0,
              transform: `translateX(${item.start}px)`,
              width: item.size,
            }}
          >
            {renderItem(item.index)}
          </div>
        ))}
      </div>
    </div>
  );
};
