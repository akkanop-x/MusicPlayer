/** Spinner — loading state กลาง (frontend.md: loading/empty/error states ทุกจุด) */
export default function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-sm text-neutral-400">
      <span
        data-testid="spinner"
        aria-hidden
        className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-600 border-t-emerald-500"
      />
      {label && <span>{label}</span>}
    </div>
  );
}
