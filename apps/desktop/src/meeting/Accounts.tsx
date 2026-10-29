import { Badge, Button, Field, Input, Select } from "@fluentui/react-components";
import type { AccountDevice, InstanceAccount, MeetingModel } from "@openmeet/shared";
import { useEffect, useState, type FormEvent } from "react";

const ROLE_LABEL: Record<string, string> = { admin: "administrador", moderator: "moderador", participant: "participante" };

// ADR 0028: a short name for the browser and system in a user agent.
function describeAgent(agent: string | null): string | null {
  if (agent === null) return null;
  const desktop = /^OpenMeet-Desktop\/\S+ \((\w+)\)/.exec(agent);
  if (desktop) return desktop[1] === "windows" ? "Windows" : (desktop[1] ?? null);
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Firefox\//.test(agent)
      ? "Firefox"
      : /Chrome\//.test(agent)
        ? "Chrome"
        : /Safari\//.test(agent)
          ? "Safari"
          : null;
  const system = /Android/.test(agent)
    ? "Android"
    : /iPhone|iPad/.test(agent)
      ? "iOS"
      : /Windows/.test(agent)
        ? "Windows"
        : /Mac OS X/.test(agent)
          ? "macOS"
          : /Linux/.test(agent)
            ? "Linux"
            : null;
  if (browser && system) return `${browser} no ${system}`;
  return browser ?? system;
}

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 20) return "ativo agora";
  if (minutes < 60) return `visto há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `visto há ${hours} h`;
  return `visto há ${Math.round(hours / 24)} d`;
}

function describeSession(session: AccountDevice): string {
  const kind = session.client === "desktop" ? "Desktop" : session.client === "web" ? "Web" : "Cliente desconhecido";
  return [session.version ? `${kind} ${session.version}` : kind, describeAgent(session.agent), ago(session.lastSeenAt)].filter((part) => part).join(" · ");
}

/** S-02: the administrator creates, disables and resets instance accounts. */
export function AccountsPanel({ model, selfId, pending }: { model: MeetingModel; selfId: string | null; pending: boolean }) {
  const [accounts, setAccounts] = useState<InstanceAccount[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"participant" | "moderator">("participant");
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const reload = async () => setAccounts(await model.listAccounts());
  useEffect(() => {
    void reload();
  }, [model]);

  const run = async (action: () => Promise<boolean>, message: string): Promise<boolean> => {
    setBusy(true);
    setDone(null);
    const ok = await action();
    if (ok) {
      setDone(message);
      await reload();
    }
    setBusy(false);
    return ok;
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await run(() => model.createAccount({ username: username.trim(), displayName: displayName.trim(), password, role }), "Conta criada.");
    if (ok) {
      setUsername("");
      setDisplayName("");
      setPassword("");
      setRole("participant");
    }
  };

  const reset = async (event: FormEvent) => {
    event.preventDefault();
    if (resetId === null) return;
    const ok = await run(() => model.resetAccountPassword(resetId, resetPassword), "Senha trocada. As sessões dessa conta caíram.");
    if (ok) {
      setResetId(null);
      setResetPassword("");
    }
  };

  const disabled = busy || pending;
  return (
    <>
      <div>
        <h2>Usuários da instância</h2>
        <p className="hint">Contas criadas aqui entram com usuário e senha. Para entrar num servidor, a pessoa ainda precisa de convite.</p>
      </div>
      <div className="settings-group">
        <form className="accounts-form" onSubmit={(event) => void create(event)}>
          <Field label="Usuário" hint="Letras, números, _ e -">
            <Input value={username} maxLength={64} autoComplete="off" onChange={(_, data) => setUsername(data.value)} />
          </Field>
          <Field label="Nome">
            <Input value={displayName} maxLength={80} autoComplete="off" onChange={(_, data) => setDisplayName(data.value)} />
          </Field>
          <Field label="Senha" hint="12 a 128 caracteres">
            <Input type="password" value={password} maxLength={128} autoComplete="new-password" onChange={(_, data) => setPassword(data.value)} />
          </Field>
          <Field label="Papel">
            <Select value={role} onChange={(_, data) => setRole(data.value === "moderator" ? "moderator" : "participant")}>
              <option value="participant">Participante</option>
              <option value="moderator">Moderador</option>
            </Select>
          </Field>
          <Button type="submit" appearance="primary" disabled={disabled || username.trim() === "" || displayName.trim() === "" || password.length < 12}>
            Criar conta
          </Button>
        </form>
        {done ? (
          <p className="hint" role="status">
            {done}
          </p>
        ) : null}
        {accounts === null ? (
          <p className="hint">Não foi possível ler as contas.</p>
        ) : (
          <ul className="accounts-list">
            {accounts.map((account) => {
              const managed = account.role !== "admin" && account.id !== selfId;
              return (
                <li key={account.id}>
                  <div className="accounts-who">
                    <strong>{account.displayName}</strong>
                    <span className="hint">
                      @{account.username} · {ROLE_LABEL[account.role] ?? account.role}
                    </span>
                    {account.disabled ? (
                      <Badge appearance="tint" color="danger">
                        desativada
                      </Badge>
                    ) : null}
                  </div>
                  {account.sessions.length > 0 ? (
                    <ul className="accounts-sessions">
                      {account.sessions.map((session) => (
                        <li key={`${session.signedInAt}-${session.lastSeenAt}`} className="hint" title={session.agent ?? undefined}>
                          {describeSession(session)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="accounts-sessions hint">Nenhuma sessão aberta.</p>
                  )}
                  {managed ? (
                    <div className="row">
                      <Button size="small" disabled={disabled} onClick={() => setResetId(resetId === account.id ? null : account.id)}>
                        Trocar senha
                      </Button>
                      <Button
                        size="small"
                        appearance="subtle"
                        className={account.disabled ? undefined : "danger-text"}
                        disabled={disabled}
                        onClick={() =>
                          void run(
                            () => model.setAccountDisabled(account.id, !account.disabled),
                            account.disabled ? "Conta reativada." : "Conta desativada. As sessões dela caíram.",
                          )
                        }
                      >
                        {account.disabled ? "Reativar" : "Desativar"}
                      </Button>
                    </div>
                  ) : null}
                  {resetId === account.id ? (
                    <form className="row" onSubmit={(event) => void reset(event)}>
                      <Input
                        type="password"
                        aria-label={`Nova senha de ${account.username}`}
                        placeholder="Nova senha"
                        value={resetPassword}
                        maxLength={128}
                        autoComplete="new-password"
                        onChange={(_, data) => setResetPassword(data.value)}
                      />
                      <Button type="submit" size="small" appearance="primary" disabled={disabled || resetPassword.length < 12}>
                        Salvar
                      </Button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
