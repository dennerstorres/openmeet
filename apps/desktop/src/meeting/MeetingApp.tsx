import { emptyStats, LiveKitPocSession, type PocSnapshot } from "@openmeet/media";
import { MeetingModel, type ShellSnapshot } from "@openmeet/shared";
import desktopPackage from "../../package.json";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { TrackView } from "../poc/TrackView";
import { createFetchApi, createLiveKitMedia } from "./api";

const idleSnapshot: PocSnapshot = {
  phase: "idle",
  disconnectReason: null,
  tiles: [],
  participants: [],
  diagnostics: [],
  devices: [],
  stats: emptyStats(),
  microphone: false,
  camera: false,
  screen: false,
};

const ERROR_TEXT: Record<string, string> = {
  invalid_api_base: "O endereço precisa ser HTTPS, ou HTTP só neste computador.",
  invalid_instance: "A instância não devolveu os dados esperados.",
  invalid_session: "A sessão devolvida não é válida.",
  invalid_credentials: "Usuário ou senha incorretos.",
  weak_password: "A senha precisa ter entre 12 e 128 caracteres.",
  bootstrap_closed: "O primeiro acesso já foi feito.",
  bootstrap_rejected: "O token de instalação não confere.",
  unauthorized: "A sessão expirou.",
  forbidden: "Sem permissão para esta sala.",
  invalid_invite: "O convite não vale.",
  room_ended: "A sala está encerrada.",
  room_not_found: "A sala não está disponível.",
  conflict: "Já existe uma sala com este identificador.",
  invalid_body: "Os dados não foram aceitos.",
  auth_unconfigured: "A instância ainda não tem banco nem segredo.",
  room_unconfigured: "A instância ainda não emite mídia.",
  connect_failed: "Não foi possível entrar na sala.",
  request_failed: "A instância não respondeu.",
  instance_unavailable: "A instância não confirmou os metadados.",
};

function errorText(code: string | null): string | null {
  if (code === null) return null;
  return ERROR_TEXT[code] ?? "A instância recusou o pedido.";
}

function storedAddress(): string {
  try {
    return localStorage.getItem("openmeet.instance") ?? "http://127.0.0.1:3000";
  } catch {
    return "http://127.0.0.1:3000";
  }
}

export function MeetingApp() {
  const sessionRef = useRef<LiveKitPocSession | null>(null);
  const modelRef = useRef<MeetingModel | null>(null);
  const [media, setMedia] = useState<PocSnapshot>(idleSnapshot);
  const [address, setAddress] = useState(storedAddress);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [roomName, setRoomName] = useState("");
  const [roomSlug, setRoomSlug] = useState("");
  const [roomKind, setRoomKind] = useState("persistent");
  const [inviteCode, setInviteCode] = useState("");

  function session(): LiveKitPocSession {
    sessionRef.current ??= new LiveKitPocSession({ appVersion: desktopPackage.version });
    return sessionRef.current;
  }

  if (modelRef.current === null) {
    modelRef.current = new MeetingModel(createFetchApi(), createLiveKitMedia(session));
  }
  const model = modelRef.current;
  const [state, setState] = useState<ShellSnapshot>(model.snapshot());

  useEffect(() => model.subscribe(setState), [model]);
  useEffect(() => session().subscribe(setMedia), []);
  useEffect(() => {
    if (state.origin === null) return;
    try {
      localStorage.setItem("openmeet.instance", state.origin);
    } catch {
      // The address is remembered when storage is available. Tokens are not stored here.
    }
  }, [state.origin]);

  const notice = errorText(state.error);
  const active = state.rooms.find((room) => room.id === state.activeRoomId);

  return (
    <main className="poc">
      <header>
        <h1>OpenMeet</h1>
        <p>{state.instanceName ?? "Instância ainda não confirmada"}</p>
        {state.origin ? <p>{state.origin}</p> : null}
        {state.userLabel ? <p>{state.userLabel}</p> : null}
      </header>
      {notice ? <p className="error">{notice}</p> : null}
      {state.step === "instance" ? (
        <InstanceStep address={address} pending={state.pending} onAddress={setAddress} onConfirm={() => void model.confirmInstance(address)} />
      ) : null}
      {state.step === "account" ? (
        <AccountStep
          bootstrapOpen={state.bootstrapOpen}
          pending={state.pending}
          username={username}
          password={password}
          displayName={displayName}
          setupToken={setupToken}
          onUsername={setUsername}
          onPassword={setPassword}
          onDisplayName={setDisplayName}
          onSetupToken={setSetupToken}
          onSubmit={(mode) => {
            void model.submitAccount({ mode, username, password, displayName, token: setupToken }).then(() => {
              setPassword("");
              setSetupToken("");
            });
          }}
          onChange={() => void model.changeInstance()}
        />
      ) : null}
      {state.step === "rooms" ? (
        <RoomsStep
          state={state}
          roomName={roomName}
          roomSlug={roomSlug}
          roomKind={roomKind}
          inviteCode={inviteCode}
          onRoomName={setRoomName}
          onRoomSlug={setRoomSlug}
          onRoomKind={setRoomKind}
          onInviteCode={setInviteCode}
          onCreate={() => void model.createRoom(roomName, roomSlug, roomKind)}
          onEnter={(roomId) => void model.enterRoom(roomId, inviteCode)}
          onReload={() => void model.reloadRooms()}
          onSignOut={() => void model.signOut()}
          onChange={() => void model.changeInstance()}
        />
      ) : null}
      {state.step === "meeting" ? (
        <section className="stack">
          <h2>{active?.name ?? "Reunião"}</h2>
          <p>
            Estado: <strong>{media.phase}</strong>
            {media.disconnectReason ? ` · ${media.disconnectReason}` : ""}
          </p>
          {media.participants.length === 0 ? (
            <p>Ninguém na sala.</p>
          ) : (
            <ul>
              {media.participants.map((person) => (
                <li key={person}>{person}</li>
              ))}
            </ul>
          )}
          <div className="tiles">
            {media.tiles.map((tile) => (
              <TrackView key={tile.id} tile={tile} />
            ))}
          </div>
          <button type="button" onClick={() => model.leaveRoom()}>
            Sair da sala
          </button>
        </section>
      ) : null}
    </main>
  );
}

function InstanceStep({
  address,
  pending,
  onAddress,
  onConfirm,
}: {
  address: string;
  pending: boolean;
  onAddress: (value: string) => void;
  onConfirm: () => void;
}) {
  return (
    <form
      className="stack"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onConfirm();
      }}
    >
      <p>A senha só é enviada depois que este endereço confirmar a instância.</p>
      <label>
        Endereço
        <input value={address} onChange={(event) => onAddress(event.currentTarget.value)} autoComplete="url" spellCheck={false} />
      </label>
      <button type="submit" disabled={pending}>
        Confirmar instância
      </button>
      <a href="?poc=1">Prova de mídia</a>
    </form>
  );
}

function AccountStep(props: {
  bootstrapOpen: boolean;
  pending: boolean;
  username: string;
  password: string;
  displayName: string;
  setupToken: string;
  onUsername: (value: string) => void;
  onPassword: (value: string) => void;
  onDisplayName: (value: string) => void;
  onSetupToken: (value: string) => void;
  onSubmit: (mode: "login" | "bootstrap") => void;
  onChange: () => void;
}) {
  return (
    <form
      className="stack"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        props.onSubmit(props.bootstrapOpen ? "bootstrap" : "login");
      }}
    >
      {props.bootstrapOpen ? (
        <label>
          Token de instalação
          <input value={props.setupToken} onChange={(event) => props.onSetupToken(event.currentTarget.value)} autoComplete="off" spellCheck={false} />
        </label>
      ) : null}
      <label>
        Usuário
        <input value={props.username} onChange={(event) => props.onUsername(event.currentTarget.value)} autoComplete="username" />
      </label>
      {props.bootstrapOpen ? (
        <label>
          Nome
          <input value={props.displayName} onChange={(event) => props.onDisplayName(event.currentTarget.value)} autoComplete="name" />
        </label>
      ) : null}
      <label>
        Senha
        <input
          type="password"
          value={props.password}
          onChange={(event) => props.onPassword(event.currentTarget.value)}
          autoComplete={props.bootstrapOpen ? "new-password" : "current-password"}
        />
      </label>
      <button type="submit" disabled={props.pending}>
        {props.bootstrapOpen ? "Criar administrador" : "Entrar"}
      </button>
      <button type="button" onClick={props.onChange}>
        Trocar instância
      </button>
    </form>
  );
}

function RoomsStep(props: {
  state: ShellSnapshot;
  roomName: string;
  roomSlug: string;
  roomKind: string;
  inviteCode: string;
  onRoomName: (value: string) => void;
  onRoomSlug: (value: string) => void;
  onRoomKind: (value: string) => void;
  onInviteCode: (value: string) => void;
  onCreate: () => void;
  onEnter: (roomId: string) => void;
  onReload: () => void;
  onSignOut: () => void;
  onChange: () => void;
}) {
  return (
    <section className="stack">
      <label>
        Código do convite
        <input value={props.inviteCode} onChange={(event) => props.onInviteCode(event.currentTarget.value)} autoComplete="off" spellCheck={false} />
      </label>
      {props.state.rooms.length === 0 ? <p>Nenhuma sala.</p> : null}
      <ul className="rooms">
        {props.state.rooms.map((room) => (
          <li key={room.id}>
            <span>
              {room.name} · {room.ended ? "encerrada" : room.kind === "temporary" ? "temporária" : "persistente"}
            </span>
            <button type="button" disabled={props.state.pending || room.ended} onClick={() => props.onEnter(room.id)}>
              Entrar
            </button>
          </li>
        ))}
      </ul>
      {props.state.canCreate ? (
        <form
          className="stack"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            props.onCreate();
          }}
        >
          <h2>Nova sala</h2>
          <label>
            Nome
            <input value={props.roomName} onChange={(event) => props.onRoomName(event.currentTarget.value)} />
          </label>
          <label>
            Identificador
            <input value={props.roomSlug} onChange={(event) => props.onRoomSlug(event.currentTarget.value)} spellCheck={false} />
          </label>
          <label>
            Tipo
            <select value={props.roomKind} onChange={(event) => props.onRoomKind(event.currentTarget.value)}>
              <option value="persistent">Persistente</option>
              <option value="temporary">Temporária</option>
            </select>
          </label>
          <button type="submit" disabled={props.state.pending}>
            Criar sala
          </button>
        </form>
      ) : null}
      <button type="button" onClick={props.onReload} disabled={props.state.pending}>
        Atualizar
      </button>
      <button type="button" onClick={props.onSignOut} disabled={props.state.pending}>
        Sair da conta
      </button>
      <button type="button" onClick={props.onChange}>
        Trocar instância
      </button>
    </section>
  );
}
