import { useState } from "react";
import { Body1, Button, Caption1, Card, CardHeader, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowDownloadRegular } from "@fluentui/react-icons";
import { instanceLink } from "@openmeet/shared";
import { DESKTOP_DOWNLOAD_URL, dismissOffer, isWindowsDesktop, offerDismissed } from "./desktopApp";

const useStyles = makeStyles({
  // Card sets its own position, so the fixed placement lives on the wrapper.
  root: {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: 20,
    width: "min(calc(100% - 32px), 360px)",
  },
  card: { boxShadow: tokens.shadow16 },
  actions: { display: "flex", justifyContent: "flex-end", gap: tokens.spacingHorizontalS },
});

// RF-27: a quiet offer of the Windows app, shown once until dismissed. It never blocks entering a room.
export function DesktopOffer() {
  const styles = useStyles();
  const [open, setOpen] = useState(() => isWindowsDesktop() && !offerDismissed());
  const [downloaded, setDownloaded] = useState(false);
  if (!open) return null;
  const close = () => {
    dismissOffer();
    setOpen(false);
  };
  return (
    <div className={styles.root}>
      <Card className={styles.card} role="status" aria-live="polite">
        <CardHeader
          image={<ArrowDownloadRegular fontSize={20} />}
          header={
            <Body1>
              <strong>OpenMeet para Windows</strong>
            </Body1>
          }
          description={
            <Caption1>
              {downloaded
                ? "Depois de instalar, abra o app por aqui para ele já entrar nesta instância."
                : "O app tem melhor desempenho, áudio do PC, bandeja e atalhos globais."}
            </Caption1>
          }
        />
        <div className={styles.actions}>
          <Button onClick={close}>Agora não</Button>
          {downloaded ? (
            <Button as="a" appearance="primary" href={instanceLink(window.location.origin)} onClick={close}>
              Abrir no app
            </Button>
          ) : (
            <Button as="a" appearance="primary" href={DESKTOP_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" onClick={() => setDownloaded(true)}>
              Baixar app
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
