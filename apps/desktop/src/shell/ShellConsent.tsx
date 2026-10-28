import { Caption1, Switch, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import type { ShellStatus } from "./native";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS },
  hint: { color: tokens.colorNeutralForeground3, marginBottom: tokens.spacingVerticalS },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalL, color: tokens.colorNeutralForeground2 },
});

export function ShellConsent({
  status,
  pending,
  onConsent,
  onAutostart,
}: {
  status: ShellStatus | null;
  pending: boolean;
  onConsent: (consent: boolean) => void;
  onAutostart: (enabled: boolean) => void;
}) {
  const styles = useStyles();
  const disabled = status === null || pending;
  return (
    <section className={mergeClasses("shortcuts", styles.root)}>
      <Switch
        label="Iniciar com o Windows"
        checked={status?.autostart ?? false}
        disabled={disabled}
        onChange={(_, data) => {
          onAutostart(data.checked);
        }}
      />
      <Caption1 className={styles.hint}>O OpenMeet abre na bandeja ao entrar no Windows.</Caption1>
      <Switch
        label="Permitir atalhos globais"
        checked={status?.shortcutConsent ?? false}
        disabled={disabled}
        onChange={(_, data) => {
          onConsent(data.checked);
        }}
      />
      <Caption1 className={styles.hint}>Eles só entram depois deste consentimento. Se o atalho já estiver em uso, ele fica de fora.</Caption1>
      {status ? (
        <ul className={styles.list}>
          {status.shortcuts.map((shortcut) => (
            <li key={shortcut.id}>
              {shortcut.accelerator} · {shortcut.registered ? "ativo" : status.shortcutConsent ? "em conflito" : "desligado"}
            </li>
          ))}
        </ul>
      ) : (
        <Caption1 className={styles.hint}>Lendo a preferência deste computador.</Caption1>
      )}
    </section>
  );
}
