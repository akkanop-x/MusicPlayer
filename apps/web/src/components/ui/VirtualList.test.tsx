/**
 * VirtualList (react-window v2) — render เฉพาะ window ที่เห็น + renderItem/keys ถูกเรียก
 * jsdom ไม่มี ResizeObserver/ไม่มี layout — stub ResizeObserver ให้ render ได้
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { VirtualList } from "./VirtualList";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;

interface Item {
  id: string;
  label: string;
}

const ITEMS: Item[] = Array.from({ length: 100 }, (_, i) => ({
  id: `id-${i}`,
  label: `item-${i}`,
}));

describe("VirtualList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("render ได้ + item แรกอยู่ใน window (100 แถว ไม่ render ทั้งหมด)", () => {
    render(
      <VirtualList
        items={ITEMS}
        itemHeight={50}
        height={200}
        renderItem={(item) => <span>{item.label}</span>}
        getKey={(item) => item.id}
      />,
    );
    expect(screen.getByTestId("virtual-list")).toBeTruthy();
    const labels = screen.getAllByText(/^item-/);
    // virtualized: render น้อยกว่าทั้งหมดอย่างชัดเจน
    expect(labels.length).toBeLessThan(ITEMS.length);
    expect(labels.length).toBeGreaterThan(0);
  });

  it("items ว่าง → render null (call site ใช้ EmptyState แทน)", () => {
    const { container } = render(
      <VirtualList<Item>
        items={[]}
        itemHeight={50}
        height={200}
        renderItem={(item) => <span>{item.label}</span>}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
