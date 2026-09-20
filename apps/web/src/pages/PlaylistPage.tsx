/** PlaylistPage — /playlist/:id placeholder (PlaylistService เป็น Phase 10) */
import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import EmptyState from "../components/ui/EmptyState";

export default function PlaylistPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();

  return (
    <div className="px-6 py-6">
      <Link to="/library" className="text-sm text-neutral-400 hover:text-neutral-200">
        {t("common:back")}
      </Link>
      <div className="mt-6">
        <EmptyState
          icon="📁"
          title={t("playlist:notFoundTitle")}
          description={t("playlist:notFoundDesc")}
          testId="playlist-placeholder"
        />
        {id && (
          <p
            className="mt-3 text-center text-xs text-neutral-600"
            data-testid="playlist-id"
          >
            id: {id}
          </p>
        )}
      </div>
    </div>
  );
}
