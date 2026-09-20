import { getAudioEngine } from "../lib/audioEngine";
import { queueApi } from "../api";
import { useQueueStore, useToastStore } from "../stores/playerStore";

function fmt(ms: number): string {
  const s = Math.max(Math.floor(ms / 1000), 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** คำสั่ง queue ทุกตัวคืน QueueStateDTO → sync store ให้ UI อัปเดตทันที */
function useQueueCommand() {
  const setQueueDto = useQueueStore((s) => s.setQueueDto);
  const show = useToastStore((s) => s.show);
  return (fn: Promise<import("@musicplayer/shared").QueueStateDTO>) =>
    fn.then(setQueueDto).catch((e: unknown) => show(String((e as Error).message)));
}

/** QueuePanel — queue.md: upcoming (ลำดับแสดงผล) + history (ใหม่→เก่า) */
export default function QueuePanel() {
  const engine = getAudioEngine();
  const { current, upcoming, history } = useQueueStore();
  const run = useQueueCommand();

  return (
    <section
      data-testid="queue-panel"
      className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2"
    >
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
            กำลังเล่น / คิวถัดไป ({upcoming.length})
          </h2>
          <button
            data-testid="queue-clear"
            onClick={() => run(queueApi.clear("upcoming"))}
            className="text-xs text-neutral-500 hover:text-neutral-300"
          >
            ล้างคิว
          </button>
        </div>
        {current && (
          <div
            data-testid="queue-current"
            className="mb-1 flex items-center gap-2 rounded bg-emerald-500/10 px-2 py-2"
          >
            <span aria-hidden>▶</span>
            <span className="min-w-0 flex-1 truncate text-sm text-emerald-300">
              {current.track.title}
            </span>
            <span className="text-xs text-neutral-500">
              {fmt(current.track.durationMs)}
            </span>
          </div>
        )}
        <ul data-testid="queue-upcoming" className="space-y-1">
          {upcoming.map((item, index) => (
            <li
              key={item.id}
              className="flex items-center gap-1 rounded px-2 py-1 hover:bg-neutral-900"
            >
              <button
                aria-label={`move up ${item.track.title}`}
                data-testid={`move-up-${index}`}
                disabled={index === 0}
                onClick={() => run(queueApi.move(item.id, index - 1))}
                className="px-1 text-neutral-500 hover:text-neutral-200 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                aria-label={`move down ${item.track.title}`}
                data-testid={`move-down-${index}`}
                disabled={index === upcoming.length - 1}
                onClick={() => run(queueApi.move(item.id, index + 1))}
                className="px-1 text-neutral-500 hover:text-neutral-200 disabled:opacity-30"
              >
                ↓
              </button>
              <span className="min-w-0 flex-1 truncate text-sm">
                {item.track.title}
              </span>
              <span className="text-xs text-neutral-500">
                {fmt(item.track.durationMs)}
              </span>
              <button
                aria-label={`remove ${item.track.title}`}
                data-testid={`remove-${index}`}
                onClick={() => run(queueApi.remove(item.id))}
                className="px-1 text-neutral-500 hover:text-red-400"
              >
                ✕
              </button>
            </li>
          ))}
          {upcoming.length === 0 && (
            <li className="px-2 py-1 text-sm text-neutral-600">
              คิวว่าง — เพิ่มเพลงจากผลค้นหา
            </li>
          )}
        </ul>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          เพลงที่เพิ่งเล่น ({history.length})
        </h2>
        <ul data-testid="queue-history" className="space-y-1">
          {history.map((item) => (
            <li key={item.id} className="flex items-center gap-2 px-2 py-1">
              <span className="min-w-0 flex-1 truncate text-sm text-neutral-400">
                {item.track.title}
              </span>
              <button
                aria-label={`play again ${item.track.title}`}
                onClick={() => void engine.play(item.track)}
                className="px-1 text-xs text-neutral-500 hover:text-neutral-200"
              >
                เล่นอีก
              </button>
            </li>
          ))}
          {history.length === 0 && (
            <li className="px-2 py-1 text-sm text-neutral-600">ยังไม่มีประวัติ</li>
          )}
        </ul>
      </div>
    </section>
  );
}
