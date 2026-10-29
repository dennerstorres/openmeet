import { useState } from "react";
import { Body1, Button, Caption1, Card, CardHeader, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowSyncRegular } from "@fluentui/react-icons";
import { applyUpdate, usePendingUpdate } from "./pwa";

const useStyles = makeStyles({
  // Card sets its own position, so the fixed placement lives on the wrapper. Top right, so it never sits
  // under the Windows app offer in the bottom corner.
  root: {
    position: "fixed",
    right: "16px",
    top: "16px",
    zIndex: 21,
    width: "min(calc(100% - 32px), 360px)",
  },
  card: { boxShadow: tokens.shadow16 },
  actions: { display: "flex", justifyContent: "flex-end", gap: tokens.spacingHorizontalS },
});

// ADR 0027: a new deploy is offered here and applied only on click; during a call the notice stays hidden.
export function WebUpdateNotice() {
  const styles = useStyles();
  const worker = usePendingUpdate();
  const [dismissed, setDismissed] = useState<ServiceWorker | null>(null);
  const [applying, setApplying] = useState(false);
  if (worker === null || worker === dismissed) return null;
  return (
    <div className={styles.root}>
      <Card className={styles.card} role="status" aria-live="polite">
        <CardHeader
          image={<ArrowSyncRegular fontSize={20} />}
          header={
            <Body1>
              <strong>Nova versão disponível</strong>
            </Body1>
          }
          description={<Caption1>Recarregue para usar a versão nova do OpenMeet.</Caption1>}
        />
        <div className={styles.actions}>
          <Button onClick={() => setDismissed(worker)} disabled={applying}>
            Depois
          </Button>
          <Button
            appearance="primary"
            disabled={applying}
            onClick={() => {
              setApplying(true);
              applyUpdate(worker);
            }}
          >
            {applying ? "Recarregando…" : "Recarregar"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
