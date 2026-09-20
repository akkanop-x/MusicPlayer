import type { ReactNode } from "react";

/** EmptyState — ทุก list/section ที่ว่างต้องบอกผู้ใช้ (ไม่ render ว่างเงียบ ๆ) */
export default function EmptyState({
  icon = "🎵",
  title,
  description,
  action,
  testId = "empty-state",
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-neutral-800 px-6 py-10 text-center"
    >
      <span aria-hidden className="text-3xl">
        {icon}
      </span>
      <p className="text-sm font-medium text-neutral-200">{title}</p>
      {description && <p className="text-xs text-neutral-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
