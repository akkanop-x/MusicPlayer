/**
 * VirtualList — frontend.md §6: virtualized list สำหรับ list ยาว (search results, queue)
 * wrapper บาง ๆ รอบ react-window v2 (List) — call site ส่ง items + renderItem เท่านั้น
 */
import { List, type RowComponentProps } from "react-window";
import type { ReactNode } from "react";

interface RowData<T> {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  getKey?: (item: T, index: number) => string;
}

function Row<T>({ index, style, items, renderItem }: RowComponentProps<RowData<T>>) {
  const item = items[index];
  return (
    <div style={style} data-index={index}>
      {item !== undefined ? renderItem(item, index) : null}
    </div>
  );
}

export function VirtualList<T>({
  items,
  renderItem,
  itemHeight,
  height,
  overscanCount = 6,
  getKey,
  className,
  testId = "virtual-list",
}: {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  itemHeight: number;
  /** ความสูง viewport (px) — จำนวนแถวที่ render = height / itemHeight (+ overscan) */
  height: number;
  overscanCount?: number;
  getKey?: (item: T, index: number) => string;
  className?: string;
  testId?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={className} data-testid={testId}>
      <List<RowData<T>>
        rowComponent={Row}
        rowProps={{ items, renderItem, getKey }}
        rowKey={(index, data) => {
          const item = data.items[index];
          return data.getKey && item !== undefined ? data.getKey(item, index) : index;
        }}
        rowCount={items.length}
        rowHeight={itemHeight}
        overscanCount={overscanCount}
        style={{ height, overflow: "auto" }}
      />
    </div>
  );
}
