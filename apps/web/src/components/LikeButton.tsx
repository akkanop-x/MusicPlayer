/**
 * LikeButton — หัวใจ (websocket.md §3 consumer "TrackRow hearts")
 * optimistic ผ่าน ["likes","ids"] cache (useLikeMutation) — อุปกรณ์อื่น sync ด้วย LIKES_CHANGED
 */
import { useTranslation } from "react-i18next";
import { useLikedIds, useLikeMutation } from "../hooks/useLibrary";

interface LikeButtonProps {
  trackId: string;
  /** ปิด propagation เมื่อวางใน row ที่คลิกได้ (search/playlist rows) */
  stopPropagation?: boolean;
}

export default function LikeButton({
  trackId,
  stopPropagation = true,
}: LikeButtonProps) {
  const { t } = useTranslation();
  const { data: likedIds } = useLikedIds();
  const like = useLikeMutation();
  const liked = likedIds?.has(trackId) ?? false;

  return (
    <button
      aria-label={t(liked ? "playlist:unlike" : "playlist:like")}
      aria-pressed={liked}
      data-testid={`like-${trackId}`}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        like.mutate({ trackId, liked: !liked });
      }}
      className={`rounded-full px-2 py-1 text-sm hover:bg-neutral-800 ${
        liked ? "text-emerald-400" : "text-neutral-400"
      }`}
    >
      {liked ? "♥" : "♡"}
    </button>
  );
}
