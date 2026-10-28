import { useEffect, useState } from "react";
import { Body1, Button, Caption1, Card, CardHeader, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowSyncRegular } from "@fluentui/react-icons";
import { checkUpdate, installUpdate, isTauri } from "./native";
import { updateFailure, watchUpdates, type UpdateView } from "./update";

const useStyles = makeStyles({
  root: {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: 20,
    width: "min(calc(100% - 32px), 360px)",
    boxShadow: tokens.shadow16,
  },
  notes: { maxHeight: "120px", overflow: "auto", whiteSpace: "pre-line", color: tokens.colorNeutralForeground3 },
  error: { color: tokens.colorPaletteRedForeground1 },
  actions: { display: "flex", justifyContent: "flex-end", gap: tokens.spacingHorizontalS },
});

export function UpdateNotice() {
  const styles = useStyles();
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
    <Card className={styles.root} role="status" aria-live="polite">
      <CardHeader
        image={<ArrowSyncRegular fontSize={20} />}
        header={
          <Body1>
            <strong>Versão {update.version} pronta</strong>
          </Body1>
        }
        description={<Caption1>Reinicie o OpenMeet para aplicar a atualização.</Caption1>}
      />
      {update.notes ? <Caption1 className={styles.notes}>{update.notes}</Caption1> : null}
      {error ? <Caption1 className={styles.error}>{error}</Caption1> : null}
      <div className={styles.actions}>
        <Button onClick={() => setDismissed(update.version)} disabled={installing}>
          Depois
        </Button>
        <Button appearance="primary" onClick={() => void install()} disabled={installing}>
          {installing ? "Reiniciando…" : "Reiniciar agora"}
        </Button>
      </div>
    </Card>
  );
}
