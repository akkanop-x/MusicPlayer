/**
 * AddToPlaylistDialog — เพิ่มเพลงเข้า playlist (api.md #31)
 * เลือก playlist ที่มี / พิมพ์ชื่อสร้างใหม่แล้วเพิ่มเข้าตัวใหม่ทันที (กระแสหลักของ J8)
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useAddTracksToPlaylistAny,
  useCreatePlaylist,
  usePlaylists,
} from "../hooks/useLibrary";
import { useToastStore } from "../stores/playerStore";

interface AddToPlaylistDialogProps {
  trackIds: string[];
  open: boolean;
  onClose: () => void;
}

export default function AddToPlaylistDialog({
  trackIds,
  open,
  onClose,
}: AddToPlaylistDialogProps) {
  const { t } = useTranslation();
  const show = useToastStore((s) => s.show);
  const { data } = usePlaylists();
  const playlists = data?.playlists ?? [];
  const addTo = useAddTracksToPlaylistAny();
  const create = useCreatePlaylist();
  const [newName, setNewName] = useState("");

  if (!open) return null;

  const done = (name: string) => {
    show(t("playlist:addedTo", { name }));
    setNewName("");
    onClose();
  };

  const addExisting = (playlistId: string, name: string) => {
    addTo.mutate(
      { playlistId, trackIds },
      {
        onSuccess: () => done(name),
        // onError toast จาก mutation เอง
      },
    );
  };

  const createAndAdd = () => {
    const name = newName.trim();
    if (!name) return;
    create.mutate(
      { name },
      {
        onSuccess: (playlist) => {
          addTo.mutate(
            { playlistId: playlist.id, trackIds },
            { onSuccess: () => done(playlist.name) },
          );
        },
      },
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      data-testid="playlist-dialog"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-neutral-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">
          {t("playlist:addToTitle", { count: trackIds.length })}
        </h2>

        <div className="mt-4 max-h-56 space-y-1 overflow-y-auto">
          {playlists.length === 0 && (
            <p className="text-sm text-neutral-500">{t("playlist:noPlaylists")}</p>
          )}
          {playlists.map((playlist) => (
            <button
              key={playlist.id}
              data-testid={`playlist-option-${playlist.id}`}
              onClick={() => addExisting(playlist.id, playlist.name)}
              className="block w-full truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-neutral-800"
            >
              📁 {playlist.name}
              <span className="ml-2 text-xs text-neutral-500">
                {t("playlist:trackCount", { count: playlist.trackCount })}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createAndAdd()}
            placeholder={t("playlist:newNamePlaceholder")}
            data-testid="playlist-new-name"
            className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
          <button
            onClick={createAndAdd}
            disabled={!newName.trim()}
            data-testid="playlist-new-create"
            className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-40"
          >
            {t("playlist:createAdd")}
          </button>
        </div>

        <button
          onClick={onClose}
          data-testid="playlist-dialog-close"
          className="mt-4 w-full rounded-lg px-3 py-2 text-sm text-neutral-400 hover:bg-neutral-800"
        >
          {t("common:cancel")}
        </button>
      </div>
    </div>
  );
}
