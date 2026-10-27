import { useEffect, useState } from "react";
import { checkUpdate, installUpdate, isTauri } from "./native";
import { updateFailure, watchUpdates, type UpdateView } from "./update";

export function UpdateNotice() {
  const [update, setUpdate] = useState<UpdateView | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    return watchUpdates(checkUpdate, setUpdate);
  }, []);

  if (!update || dismissed === update.version) return null;

  async function install() {
    setInstalling(true);
    setError(null);
    try {
      await installUpdate();
    } catch (failure) {
      setError(updateFailure(failure));
      setInstalling(false);
    }
  }

  return (
    <aside className="update-notice" role="status" aria-live="polite">
      <strong>Versão {update.version} pronta</strong>
      <p>Reinicie o OpenMeet para aplicar a atualização.</p>
      {update.notes ? <p className="update-notes">{update.notes}</p> : null}
      {error ? <p className="update-error">{error}</p> : null}
      <div className="update-actions">
        <button type="button" onClick={() => setDismissed(update.version)} disabled={installing}>
          Depois
        </button>
        <button type="button" className="primary" onClick={() => void install()} disabled={installing}>
          {installing ? "Reiniciando…" : "Reiniciar agora"}
        </button>
      </div>
    </aside>
  );
}
