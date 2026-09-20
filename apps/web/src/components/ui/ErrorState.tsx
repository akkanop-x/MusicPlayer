/** ErrorState — error ที่ผู้ใช้เห็นได้ พร้อมปุ่ม retry (ถ้ามี) */
export default function ErrorState({
  message,
  retryLabel,
  onRetry,
  testId = "error-state",
}: {
  message: string;
  retryLabel?: string;
  onRetry?: () => void;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col items-center gap-3 rounded-xl border border-red-900/50 bg-red-950/20 px-6 py-8 text-center"
    >
      <p className="text-sm text-red-300">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-lg border border-neutral-700 px-4 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900"
        >
          ↻ {retryLabel}
        </button>
      )}
    </div>
  );
}
