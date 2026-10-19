import type { ShellStatus } from "./native";

export function ShellConsent({ status, pending, onConsent }: { status: ShellStatus | null; pending: boolean; onConsent: (consent: boolean) => void }) {
  return (
    <section className="shortcuts">
      <label>
        <input
          type="checkbox"
          checked={status?.shortcutConsent ?? false}
          disabled={status === null || pending}
          onChange={(event) => {
            onConsent(event.currentTarget.checked);
          }}
        />
        Permitir atalhos globais
      </label>
      <p>Eles só entram depois deste consentimento. Se o atalho já estiver em uso, ele fica de fora.</p>
      {status ? (
        <ul>
          {status.shortcuts.map((shortcut) => (
            <li key={shortcut.id}>
              {shortcut.accelerator} · {shortcut.registered ? "ativo" : status.shortcutConsent ? "em conflito" : "desligado"}
            </li>
          ))}
        </ul>
      ) : (
        <p>Lendo a preferência deste computador.</p>
      )}
    </section>
  );
}
