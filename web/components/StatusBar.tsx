import { formatBytes, formatDateTime } from "@/lib/format";
import type { AgentStatus } from "@/lib/types";

/** Résumé de l'état de l'agent local : caméra, enregistrement, stockage. */
export function StatusBar({ status }: { status: AgentStatus | null }) {
  if (!status) {
    return (
      <div className="notice">
        Aucun signal de l’agent local. Vérifiez qu’il tourne et qu’il accède bien au dossier Drive.
      </div>
    );
  }

  const staleMs = Date.now() - new Date(status.updatedAt).getTime();
  const stale = staleMs > 5 * 60_000;

  return (
    <div className="status-row">
      <span className={`pill ${status.cameraOnline && !stale ? "ok" : "off"}`}>
        <span className="led" />
        Caméra <b>{stale ? "hors ligne" : status.cameraOnline ? "en ligne" : "injoignable"}</b>
      </span>
      {status.recording && !stale && (
        <span className="pill rec">
          <span className="led" />
          <b>Enregistrement</b>
        </span>
      )}
      <span className="pill">
        Dernier mouvement <b>{formatDateTime(status.lastMotionAt)}</b>
      </span>
      <span className="pill">
        Archive <b>{status.clipCount} clips · {formatBytes(status.storageBytes)}</b>
      </span>
      {stale && (
        <span className="pill off">
          <span className="led" />
          Signal daté de <b>{formatDateTime(status.updatedAt)}</b>
        </span>
      )}
      {status.error && (
        <span className="pill off">
          <span className="led" />
          <b>{status.error}</b>
        </span>
      )}
    </div>
  );
}
