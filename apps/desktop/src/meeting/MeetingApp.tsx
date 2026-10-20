import {
  buildCards,
  cardInitial,
  DEFAULT_PLAYBACK,
  describeMediaError,
  emptyStats,
  formatElapsed,
  keepPin,
  LiveKitPocSession,
  localScreenSurface,
  mediaActionError,
  EMPTY_RECONNECT,
  meetingElapsedMs,
  nextPlayback,
  placeCards,
  reconnectLabel,
  publicationControlsEnabled,
  screenCaption,
  screenShareAction,
  type CardLayout,
  type DeviceKind,
  type DeviceOption,
  type PlaybackLevel,
  type PocSnapshot,
} from "@openmeet/media";
import { MeetingModel, type InstanceApi, type SessionBroker, type ShellSnapshot } from "@openmeet/shared";
import desktopPackage from "../../package.json";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { holdMeetingLock } from "../shell/background";
import { CardStage } from "./Cards";
import { IconCamera, IconClock, IconGear, IconHangUp, IconHeadphones, IconLogo, IconMic, IconPlus, IconScreen, IconSignal, IconSpeaker } from "./Icons";
import { ShellConsent } from "../shell/ShellConsent";
import {
  createDesktopApi,
  createDesktopBroker,
  isTauri,
  listenInvite,
  listenShell,
  openGoogleLogin,
  setShortcutConsent,
  shellStatus,
  shellTracks,
  showWindow,
  takeInvite,
  type ShellStatus,
} from "../shell/native";
import { createFetchApi, createLiveKitMedia } from "./api";
import { createWebSession } from "../web/session";

const idleSnapshot: PocSnapshot = {
  phase: "idle",
  disconnectReason: null,
  tiles: [],
  participants: [],
  diagnostics: [],
  devices: [],
  stats: emptyStats(),
  reconnect: EMPTY_RECONNECT,
  microphone: false,
  camera: false,
  screen: false,
  audioPlayback: true,
  speakers: [],
  screenAudio: "off",
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
  forbidden: "Sem permissão para isso.",
  google_unconfigured: "Esta instância não tem login Google.",
  google_denied: "O Google não confirmou a entrada.",
  google_failed: "Não foi possível entrar com o Google. Tente de novo ou use usuário e senha.",
  google_expired: "O pedido de entrada com o Google expirou. Tente de novo.",
  account_disabled: "Esta conta está desativada nesta instância.",
  server_not_found: "O servidor não está disponível.",
  invalid_invite: "O convite não vale.",
  room_ended: "A sala está encerrada.",
  room_not_found: "A sala não está disponível.",
  conflict: "Já existe uma sala com este identificador.",
  invalid_body: "Os dados não foram aceitos.",
  auth_unconfigured: "A instância ainda não tem banco nem segredo.",
  room_unconfigured: "A instância ainda não emite mídia.",
  connect_failed: "Não foi possível entrar na sala.",
  request_failed: "A instância não respondeu.",
  instance_outdated: "A instância está desatualizada para este app. Peça ao operador para atualizar a API.",
  instance_unavailable: "A instância não confirmou os metadados.",
};

const PRESENCE_MS = 5000;

function errorText(code: string | null): string | null {
  if (code === null) return null;
  return ERROR_TEXT[code] ?? "A instância recusou o pedido.";
}

const SHARE_AUDIO_KEY = "openmeet.shareAudio";

// ADR 0008: the choice may stay on this PC, and it is always visible next to the share button.
function storedShareAudio(): boolean {
  try {
    return localStorage.getItem(SHARE_AUDIO_KEY) === "1";
  } catch {
    return false;
  }
}

// ADR 0014: the web build has one instance, the origin that served the page. `__WEB__` is replaced at
// build time (vite.config.ts), so the branches of the other target leave the bundle.
function platform(): { api: InstanceApi; broker: SessionBroker | undefined } {
  if (__WEB__) return createWebSession();
  return { api: isTauri() ? createDesktopApi(createFetchApi()) : createFetchApi(), broker: isTauri() ? createDesktopBroker() : undefined };
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
  const [address, setAddress] = useState(() => (__WEB__ ? "" : storedAddress()));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [roomName, setRoomName] = useState("");
  const [roomSlug, setRoomSlug] = useState("");
  const [roomKind, setRoomKind] = useState("persistent");
  const [serverName, setServerName] = useState("");
  const [pastedInvite, setPastedInvite] = useState("");
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState<"server" | "room" | null>(null);
  const [layout, setLayout] = useState<CardLayout>("spotlight");
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  // ADR 0013: only this PC, only during the call, never saved.
  const [deafened, setDeafened] = useState(false);
  const [shareAudio, setShareAudio] = useState(storedShareAudio);
  const [levels, setLevels] = useState<Record<string, PlaybackLevel>>({});
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [controlPending, setControlPending] = useState(false);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [shell, setShell] = useState<ShellStatus | null>(null);
  const [shellPending, setShellPending] = useState(false);
  const [exportConsent, setExportConsent] = useState(false);
  const mediaRef = useRef(media);
  mediaRef.current = media;

  function session(): LiveKitPocSession {
    sessionRef.current ??= new LiveKitPocSession({ appVersion: desktopPackage.version });
    return sessionRef.current;
  }

  if (modelRef.current === null) {
    const { api, broker } = platform();
    modelRef.current = new MeetingModel(api, createLiveKitMedia(session), broker);
  }
  const model = modelRef.current;
  const [state, setState] = useState<ShellSnapshot>(model.snapshot());

  const shellActionRef = useRef<(action: string) => Promise<void>>(async () => undefined);
  shellActionRef.current = async (action) => {
    // S-16: the tray "Sair da conta" is the same sign-out as the button on the screen.
    if (action === "sign-out") {
      await model.signOut();
      return;
    }
    const kind = action === "toggle-microphone" ? "microphone" : action === "toggle-camera" ? "camera" : null;
    if (kind === null) return;
    const current = mediaRef.current;
    const live = state.step === "meeting" && publicationControlsEnabled(current.phase);
    if (!live) {
      setMediaError("Não há reunião ativa.");
      await showWindow().catch(() => undefined);
      return;
    }
    const enable = kind === "microphone" ? !current.microphone : !current.camera;
    try {
      if (kind === "microphone") await session().setMicrophone(enable);
      else await session().setCamera(enable);
      const microphone = kind === "microphone" ? enable : current.microphone;
      const camera = kind === "camera" ? enable : current.camera;
      await shellTracks(true, microphone, camera, kind).catch(() => undefined);
    } catch (caught) {
      setMediaError(mediaActionError(kind, caught));
      await showWindow().catch(() => undefined);
    }
  };

  useEffect(() => model.subscribe(setState), [model]);
  useEffect(() => {
    if (__WEB__) void model.confirmInstance(window.location.origin);
  }, [model]);
  const presenceKey = state.step === "rooms" || state.step === "meeting" ? `${state.selectedServerId ?? ""}:${state.activeRoomId ?? ""}` : null;
  useEffect(() => {
    if (presenceKey === null) return;
    void model.refreshPresence();
    const timer = window.setInterval(() => void model.refreshPresence(), PRESENCE_MS);
    return () => window.clearInterval(timer);
  }, [model, presenceKey]);
  useEffect(() => {
    if (!isTauri()) return;
    let stop: (() => void) | undefined;
    let closed = false;
    const offer = (link: string) => {
      model.offerInvite(link);
      void showWindow().catch(() => undefined);
    };
    void takeInvite()
      .then((link) => {
        if (!closed && link !== null) offer(link);
      })
      .catch(() => undefined);
    void listenInvite(offer).then((unlisten) => {
      if (closed) unlisten();
      else stop = unlisten;
    });
    return () => {
      closed = true;
      stop?.();
    };
  }, [model]);
  useEffect(() => session().subscribe(setMedia), []);
  useEffect(() => {
    if (!isTauri()) return;
    void shellStatus()
      .then(setShell)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let stop: (() => void) | undefined;
    let closed = false;
    void listenShell((action) => {
      void shellActionRef.current(action);
    }).then((unlisten) => {
      if (closed) unlisten();
      else stop = unlisten;
    });
    return () => {
      closed = true;
      stop?.();
    };
  }, []);
  useEffect(() => {
    const live = state.step === "meeting" && publicationControlsEnabled(media.phase);
    if (!live) return;
    return holdMeetingLock();
  }, [state.step, media.phase]);
  useEffect(() => {
    if (!isTauri()) return;
    const live = state.step === "meeting" && publicationControlsEnabled(media.phase);
    void shellTracks(live, media.microphone, media.camera, null).catch(() => undefined);
  }, [state.step, media.phase, media.microphone, media.camera]);
  useEffect(() => {
    const live = state.step === "meeting" && (media.phase === "connected" || media.phase === "reconnecting");
    if (!live) {
      if (state.step !== "meeting" || media.phase === "idle" || media.phase === "fatal") setConnectedAt(null);
      return;
    }
    setConnectedAt((current) => current ?? Date.now());
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.step, media.phase]);
  useEffect(() => {
    if (state.step !== "meeting" || (media.phase !== "connected" && media.phase !== "reconnecting")) return;
    let cancelled = false;
    void session()
      .refreshDevices()
      .catch((caught: unknown) => {
        if (!cancelled) setMediaError(describeMediaError(caught));
      });
    const timer = window.setInterval(() => {
      void session()
        .refreshStats()
        .catch((caught: unknown) => {
          if (!cancelled) setMediaError(describeMediaError(caught));
        });
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [state.step, media.phase]);
  useEffect(() => {
    if (state.origin === null || __WEB__) return;
    try {
      localStorage.setItem("openmeet.instance", state.origin);
    } catch {
      // The address is remembered when storage is available. Tokens are not stored here.
    }
  }, [state.origin]);

  const notice = errorText(state.error);
  const inCall = state.step === "meeting";
  const controlsEnabled = publicationControlsEnabled(media.phase);
  const elapsedMs = meetingElapsedMs(connectedAt, now, inCall ? media.phase : "idle");
  const elapsedLabel = elapsedMs === null ? null : formatElapsed(elapsedMs);
  const reconnectText = reconnectLabel(media.reconnect);
  const cards = inCall ? buildCards(media.participants, media.tiles) : [];
  const pin = keepPin(cards, pinnedId);
  const placement = placeCards(cards, layout, pin);
  const selectedServer = state.servers.find((server) => server.id === state.selectedServerId);
  const browsingAway = inCall && state.activeServerId !== null && state.activeServerId !== state.selectedServerId;
  const caption = screenCaption(localScreenSurface(media.tiles), media.screen);
  const isFullscreen = inCall && fullscreen && layout === "spotlight";
  const activeServer = state.servers.find((server) => server.id === state.activeServerId);
  const toggleMicrophone = () => void runControl("microphone", () => session().setMicrophone(!media.microphone));
  const toggleCamera = () => void runControl("camera", () => session().setCamera(!media.camera));
  const toggleScreen = () => void runControl("screen", () => session().setScreenShare(screenShareAction(media.screen) === "start", shareAudio));
  const toggleDeafen = () => setDeafened((current) => !current);
  const leaveCall = () => {
    setMediaError(null);
    model.leaveRoom();
  };

  useEffect(() => {
    if (pinnedId !== null && pin === null) setPinnedId(null);
  }, [pinnedId, pin]);
  useEffect(() => {
    if (!inCall) {
      setFullscreen(false);
      setPinnedId(null);
      setDeafened(false);
    }
  }, [inCall]);
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  function exportDiagnostic(): void {
    const body = session().exportDiagnostic(exportConsent, new Date().toISOString());
    if (body === null) return;
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "openmeet-diagnostico.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  function levelFor(id: string): PlaybackLevel {
    return levels[id] ?? DEFAULT_PLAYBACK;
  }

  function changeLevel(id: string, patch: Partial<PlaybackLevel>): void {
    setLevels((current) => ({ ...current, [id]: nextPlayback(current[id] ?? DEFAULT_PLAYBACK, patch) }));
  }

  function onDevice(kind: DeviceKind, deviceId: string): void {
    if (deviceId.length === 0) return;
    void runControl("device", () => session().selectDevice(kind, deviceId));
  }

  async function refreshDevices(): Promise<void> {
    setMediaError(null);
    try {
      await session().refreshDevices();
    } catch (caught) {
      setMediaError(describeMediaError(caught));
    }
  }

  async function runControl(label: string, action: () => Promise<void>): Promise<void> {
    setControlPending(true);
    setMediaError(null);
    try {
      await action();
    } catch (caught) {
      setMediaError(mediaActionError(label, caught));
    } finally {
      setControlPending(false);
    }
  }

  const consent =
    !__WEB__ && isTauri() && state.step !== "instance" ? (
      <ShellConsent
        status={shell}
        pending={shellPending}
        onConsent={(consent) => {
          setShellPending(true);
          void setShortcutConsent(consent)
            .then(setShell)
            .catch(() => {
              setMediaError("Não foi possível gravar a preferência de atalhos.");
            })
            .finally(() => {
              setShellPending(false);
            });
        }}
      />
    ) : null;

  const invitePanel = (
    <InvitePanel
      offer={state.inviteOffer}
      waiting={state.step === "account" || state.step === "instance" ? state.inviteWaiting : null}
      pending={state.pending}
      onAccept={() => void model.acceptInvite()}
      onDecline={() => model.declineInvite()}
    />
  );

  if (state.step === "instance" || state.step === "account") {
    return (
      <main className="auth-shell">
        <div className="auth-card">
          <section className="auth-form">
            <header className="auth-head">
              <h1>{state.step === "instance" ? "Boas-vindas!" : state.bootstrapOpen ? "Criar administrador" : "Boas-vindas de volta!"}</h1>
              <p>
                {state.step !== "instance"
                  ? "Entre na instância para ver seus servidores."
                  : __WEB__
                    ? "Conectando a esta instância."
                    : "Informe o endereço da sua instância."}
              </p>
            </header>
            {notice ? <p className="error">{notice}</p> : null}
            {invitePanel}
            {consent}
            {state.step === "instance" && __WEB__ ? (
              <WebInstanceStep pending={state.pending} onRetry={() => void model.confirmInstance(window.location.origin)} />
            ) : state.step === "instance" ? (
              <InstanceStep address={address} pending={state.pending} onAddress={setAddress} onConfirm={() => void model.confirmInstance(address)} />
            ) : (
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
                onChange={__WEB__ ? null : () => void model.changeInstance()}
                googleLogin={state.googleLogin}
                googleWaiting={state.googleWaiting}
                onGoogle={() => void model.loginWithGoogle(openGoogleLogin)}
                onCancelGoogle={() => model.cancelGoogle()}
              />
            )}
          </section>
          <aside className="auth-side">
            <span className="auth-mark">
              <IconLogo size={56} />
            </span>
            <strong>OpenMeet</strong>
            <p>{state.instanceName ?? "Sem instância"}</p>
            {state.origin ? <p className="origin">{state.origin}</p> : null}
          </aside>
        </div>
      </main>
    );
  }

  return (
    <main className={`server-shell${isFullscreen ? " is-fullscreen" : ""}`}>
      <nav className="server-bar" aria-label="Servidores">
        {state.servers.map((server) => (
          <button
            key={server.id}
            type="button"
            className={`server-pill${server.id === state.selectedServerId ? " selected" : ""}${server.id === state.activeServerId ? " live" : ""}`}
            title={server.name}
            aria-label={server.name}
            aria-current={server.id === state.selectedServerId ? "true" : undefined}
            onClick={() => void model.selectServer(server.id)}
          >
            {cardInitial(server.name)}
          </button>
        ))}
        {state.canCreateServer ? (
          <button
            type="button"
            className="server-pill add"
            title="Criar servidor"
            aria-label="Criar servidor"
            onClick={() => setCreating(creating === "server" ? null : "server")}
          >
            <IconPlus size={22} />
          </button>
        ) : null}
      </nav>

      <aside className="room-bar">
        <header className="room-bar-head">
          <strong>{selectedServer?.name ?? state.instanceName ?? "OpenMeet"}</strong>
          {selectedServer ? <span>{roleLabel(selectedServer.role)}</span> : null}
        </header>
        {creating === "server" ? (
          <form
            className="inline-form"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void model.createServer(serverName).then(() => {
                setServerName("");
                setCreating(null);
              });
            }}
          >
            <label>
              Nome do servidor
              <input value={serverName} onChange={(event) => setServerName(event.currentTarget.value)} maxLength={80} autoFocus />
            </label>
            <button type="submit" disabled={state.pending}>
              Criar servidor
            </button>
          </form>
        ) : null}
        {state.servers.length === 0 ? (
          <p className="hint">
            {state.canCreateServer ? "Crie o primeiro servidor no botão + à esquerda." : "Você ainda não participa de nenhum servidor. Peça um convite."}
          </p>
        ) : null}
        <ul className="room-list">
          {state.rooms.map((room) => (
            <li key={room.id}>
              <button
                type="button"
                className={`room-item${room.id === state.activeRoomId ? " active" : ""}`}
                disabled={state.pending || room.ended || room.id === state.activeRoomId}
                onClick={() => void model.enterRoom(room.id, "")}
              >
                {room.kind === "temporary" ? <IconClock /> : <IconSpeaker />}
                <span className="room-name">{room.name}</span>
                {room.ended ? <span className="badge">encerrada</span> : room.kind === "temporary" ? <span className="sr">temporária</span> : null}
              </button>
              {(state.presence?.[room.id] ?? []).length > 0 ? (
                <ul className="occupants" aria-label={`Na sala ${room.name}`}>
                  {(state.presence?.[room.id] ?? []).map((person) => {
                    const speaking = room.id === state.activeRoomId && media.speakers.includes(person.id);
                    return (
                      <li key={person.id} className={speaking ? "speaking" : undefined}>
                        <span className="avatar tiny" aria-hidden="true">
                          <span>{cardInitial(person.label)}</span>
                        </span>
                        <span className="room-name">{person.label}</span>
                        {speaking ? <span className="sr"> falando</span> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
        {selectedServer && state.rooms.length === 0 ? <p className="hint">Nenhuma sala neste servidor.</p> : null}
        {state.canCreate ? (
          state.createdInvite ? (
            <div className="inline-form invite-out">
              <span className="hint">Link de convite · vale 24 h e 10 usos</span>
              <input readOnly value={state.createdInvite} aria-label="Link de convite" onFocus={(event) => event.currentTarget.select()} />
              <div className="row">
                <button
                  type="button"
                  className="primary"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(state.createdInvite ?? "")
                      .then(() => setCopied(true))
                      .catch(() => setMediaError("Não foi possível copiar. Selecione o link e copie."))
                  }
                >
                  {copied ? "Copiado" : "Copiar link"}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setCopied(false);
                    model.clearCreatedInvite();
                  }}
                >
                  Fechar
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="ghost add-room"
              disabled={state.pending}
              onClick={() => {
                setCopied(false);
                void model.createInvite();
              }}
            >
              Convidar para {selectedServer?.name ?? "o servidor"}
            </button>
          )
        ) : null}
        {state.canCreate ? (
          creating === "room" ? (
            <form
              className="inline-form"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                void model.createRoom(roomName, roomSlug, roomKind).then(() => {
                  setRoomName("");
                  setRoomSlug("");
                  setCreating(null);
                });
              }}
            >
              <label>
                Nome
                <input value={roomName} onChange={(event) => setRoomName(event.currentTarget.value)} maxLength={80} autoFocus />
              </label>
              <label>
                Identificador
                <input value={roomSlug} onChange={(event) => setRoomSlug(event.currentTarget.value)} spellCheck={false} maxLength={64} />
              </label>
              <label>
                Tipo
                <select value={roomKind} onChange={(event) => setRoomKind(event.currentTarget.value)}>
                  <option value="persistent">Persistente</option>
                  <option value="temporary">Temporária</option>
                </select>
              </label>
              <div className="row">
                <button type="submit" disabled={state.pending}>
                  Criar sala
                </button>
                <button type="button" className="ghost" onClick={() => setCreating(null)}>
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="ghost add-room" onClick={() => setCreating("room")}>
              + Nova sala
            </button>
          )
        ) : null}
        <form
          className="paste-invite"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            model.offerInvite(pastedInvite);
            setPastedInvite("");
          }}
        >
          <label>
            <span className="hint">Tenho um convite</span>
            <input
              value={pastedInvite}
              onChange={(event) => setPastedInvite(event.currentTarget.value)}
              placeholder="Cole o link ou o código"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </form>
        {inCall ? (
          <section className="voice-panel" aria-label="Chamada atual">
            <div className="voice-row">
              <span className={`voice-icon${reconnectText ? " warn" : ""}`}>
                <IconSignal />
              </span>
              <div>
                <strong className={reconnectText ? "warn" : undefined}>{reconnectText ? "Reconectando" : "Voz conectada"}</strong>
                <p className="origin">
                  {state.activeRoomName ?? "Reunião"} / {activeServer?.name ?? "servidor"}
                </p>
              </div>
              <button type="button" className="icon-btn" aria-label="Sair da sala" title="Sair da sala" onClick={leaveCall}>
                <IconHangUp />
              </button>
            </div>
            <div className="voice-actions">
              <button type="button" className={media.camera ? "on" : ""} disabled={!controlsEnabled || controlPending} onClick={toggleCamera}>
                <IconCamera size={18} off={!media.camera} />
                Câmera
              </button>
              <button
                type="button"
                className={media.screen ? "on" : ""}
                aria-pressed={media.screen}
                disabled={!controlsEnabled || controlPending}
                onClick={toggleScreen}
              >
                <IconScreen size={18} />
                Tela
              </button>
            </div>
          </section>
        ) : null}
        <footer className="account">
          <span className="avatar small" aria-hidden="true">
            <span>{cardInitial(state.userLabel ?? "?")}</span>
          </span>
          <div className="you-name">
            <strong>{state.userLabel}</strong>
            <p className="origin">{inCall ? `Em ${state.activeRoomName ?? "reunião"}` : state.origin}</p>
          </div>
          {inCall ? (
            <>
              <button
                type="button"
                className={`icon-btn${media.microphone ? "" : " danger-text"}`}
                aria-label={media.microphone ? "Desligar microfone" : "Ligar microfone"}
                title={media.microphone ? "Desligar microfone" : "Ligar microfone"}
                disabled={!controlsEnabled || controlPending}
                onClick={toggleMicrophone}
              >
                <IconMic off={!media.microphone} />
              </button>
              <button
                type="button"
                className={`icon-btn${deafened ? " danger-text" : ""}`}
                aria-label="Ensurdecer"
                aria-pressed={deafened}
                title={deafened ? "Voltar a ouvir as pessoas neste PC" : "Cortar o som de todos neste PC. O microfone não muda."}
                onClick={toggleDeafen}
              >
                <IconHeadphones off={deafened} />
              </button>
            </>
          ) : null}
          <details className="account-menu">
            <summary className="icon-btn" aria-label="Conta" title="Conta">
              <IconGear />
            </summary>
            <div className="menu">
              <button type="button" className="ghost" onClick={() => void model.reloadRooms()} disabled={state.pending}>
                Atualizar
              </button>
              {__WEB__ ? null : (
                <button type="button" className="ghost" onClick={() => void model.changeInstance()}>
                  Trocar instância
                </button>
              )}
              <button type="button" className="ghost danger-text" onClick={() => void model.signOut()} disabled={state.pending}>
                Sair da conta
              </button>
            </div>
          </details>
        </footer>
      </aside>

      <section className="call-area">
        {notice ? <p className="error">{notice}</p> : null}
        {invitePanel}
        {mediaError ? <p className="error">{mediaError}</p> : null}
        {consent}
        {inCall ? (
          <>
            <header className="call-strip">
              <button
                type="button"
                className={`call-room${browsingAway ? " away" : ""}`}
                disabled={!browsingAway}
                onClick={() => state.activeServerId !== null && void model.selectServer(state.activeServerId)}
                title={browsingAway ? "Voltar ao servidor desta chamada" : undefined}
              >
                <span className="live-dot" aria-hidden="true" />
                {state.activeRoomName ?? "Reunião"}
                {browsingAway ? <span className="hint"> · voltar ao servidor</span> : null}
              </button>
              <p>
                {media.participants.length} na sala
                {elapsedLabel ? ` · ${elapsedLabel}` : ""}
                {reconnectText ? ` · ${reconnectText}` : ""}
                {media.disconnectReason ? ` · ${media.disconnectReason}` : ""}
              </p>
              <div className="segmented" role="group" aria-label="Layout">
                <button type="button" aria-pressed={layout === "spotlight"} onClick={() => setLayout("spotlight")}>
                  Destaque
                </button>
                <button
                  type="button"
                  aria-pressed={layout === "grid"}
                  onClick={() => {
                    setLayout("grid");
                    setFullscreen(false);
                  }}
                >
                  Grade
                </button>
              </div>
              {layout === "spotlight" ? (
                <button type="button" className="ghost" onClick={() => setFullscreen(true)} disabled={placement.featuredId === null}>
                  Tela cheia
                </button>
              ) : null}
            </header>
            {caption ? (
              <p className="sharing">
                {caption}
                {media.screenAudio === "on" ? " com o áudio do PC" : ""}. Para trocar a origem, pare e escolha de novo.
              </p>
            ) : null}
            {media.screenAudio === "missing" ? (
              <p className="error" role="status">
                Esta origem não trouxe o áudio do PC. Só a imagem está sendo compartilhada. No Windows, o som costuma vir ao escolher a tela inteira com a opção
                de áudio marcada no seletor.
              </p>
            ) : null}
            <CardStage
              cards={cards}
              tiles={media.tiles}
              layout={layout}
              featuredId={placement.featuredId}
              others={placement.others}
              pinnedId={pin}
              speakers={media.speakers}
              deafened={deafened}
              fullscreen={isFullscreen}
              levelFor={levelFor}
              onLevel={changeLevel}
              onPin={setPinnedId}
            />
            <div className={`dock${isFullscreen ? " thin" : ""}`}>
              {media.audioPlayback ? null : (
                <button
                  type="button"
                  className="primary"
                  onClick={() =>
                    void session()
                      .startRemoteAudio()
                      .catch((caught: unknown) => setMediaError(mediaActionError("audio", caught)))
                  }
                >
                  Ativar som
                </button>
              )}
              <button
                type="button"
                className={`ctl${media.microphone ? "" : " off"}`}
                aria-label={media.microphone ? "Desligar microfone" : "Ligar microfone"}
                title={media.microphone ? "Microfone ligado" : "Microfone desligado"}
                disabled={!controlsEnabled || controlPending}
                onClick={toggleMicrophone}
              >
                <IconMic size={22} off={!media.microphone} />
              </button>
              <button
                type="button"
                className={`ctl${media.camera ? " on" : ""}`}
                aria-label={media.camera ? "Desligar câmera" : "Ligar câmera"}
                title={media.camera ? "Câmera ligada" : "Câmera desligada"}
                disabled={!controlsEnabled || controlPending}
                onClick={toggleCamera}
              >
                <IconCamera size={22} off={!media.camera} />
              </button>
              <button
                type="button"
                className={`ctl${media.screen ? " on" : ""}`}
                aria-label={media.screen ? "Parar compartilhamento" : "Compartilhar tela"}
                title={media.screen ? "Parar compartilhamento" : "Compartilhar tela"}
                aria-pressed={media.screen}
                disabled={!controlsEnabled || controlPending}
                onClick={toggleScreen}
              >
                <IconScreen size={22} />
              </button>
              <button
                type="button"
                className={`ctl${deafened ? " off" : ""}`}
                aria-label="Ensurdecer"
                aria-pressed={deafened}
                title={deafened ? "Voltar a ouvir as pessoas neste PC" : "Cortar o som de todos neste PC. O microfone não muda."}
                onClick={toggleDeafen}
              >
                <IconHeadphones size={22} off={deafened} />
              </button>
              <label className="share-audio" title="Pede o som do PC junto com a imagem. Muda na próxima vez que compartilhar.">
                <input
                  type="checkbox"
                  checked={shareAudio}
                  disabled={media.screen}
                  onChange={(event) => {
                    const next = event.currentTarget.checked;
                    setShareAudio(next);
                    try {
                      localStorage.setItem(SHARE_AUDIO_KEY, next ? "1" : "0");
                    } catch {
                      // The choice still holds for this window.
                    }
                  }}
                />
                Incluir áudio do PC
              </label>
              {isFullscreen ? (
                <button type="button" className="ghost" onClick={() => setFullscreen(false)}>
                  Sair da tela cheia
                </button>
              ) : (
                <details className="more">
                  <summary className="ctl" aria-label="Dispositivos e diagnóstico" title="Dispositivos e diagnóstico">
                    <IconGear size={22} />
                  </summary>
                  <div className="more-body">
                    <DeviceSelect label="Entrada" kind="audioinput" devices={media.devices} disabled={!controlsEnabled || controlPending} onChange={onDevice} />
                    <DeviceSelect label="Saída" kind="audiooutput" devices={media.devices} disabled={!controlsEnabled || controlPending} onChange={onDevice} />
                    <DeviceSelect label="Câmera" kind="videoinput" devices={media.devices} disabled={!controlsEnabled || controlPending} onChange={onDevice} />
                    <button type="button" disabled={!controlsEnabled} onClick={() => void refreshDevices()}>
                      Atualizar dispositivos
                    </button>
                    <p className="metrics">
                      {media.stats.userAgent ?? "user agent indisponível"} · app {media.stats.appVersion ?? "—"}
                    </p>
                    {media.stats.available ? (
                      <p className="metrics">
                        perda {media.stats.packetsLost ?? "—"} · jitter {media.stats.jitterMs ?? "—"} ms · RTT {media.stats.rttMs ?? "—"} ms · candidato{" "}
                        {media.stats.candidateType ?? "—"} · saída {media.stats.outboundWidth ?? "—"}x{media.stats.outboundHeight ?? "—"} @{" "}
                        {media.stats.outboundFps ?? "—"} fps · superfície {media.stats.displaySurface ?? "—"}
                      </p>
                    ) : (
                      <p className="metrics">Métricas ainda não disponíveis.</p>
                    )}
                    <label className="export">
                      <input
                        type="checkbox"
                        checked={exportConsent}
                        onChange={(event) => {
                          setExportConsent(event.currentTarget.checked);
                        }}
                      />
                      Autorizar exportação do diagnóstico
                    </label>
                    <button type="button" disabled={!exportConsent} onClick={() => exportDiagnostic()}>
                      Exportar diagnóstico
                    </button>
                  </div>
                </details>
              )}
              <span className="dock-sep" aria-hidden="true" />
              <button type="button" className="ctl leave" aria-label="Sair da sala" title="Sair da sala" onClick={leaveCall}>
                <IconHangUp size={24} />
              </button>
            </div>
          </>
        ) : (
          <div className="idle">
            <p>{state.rooms.length > 0 ? "Escolha uma sala à esquerda para entrar." : "Nenhuma chamada em andamento."}</p>
          </div>
        )}
      </section>
    </main>
  );
}

function roleLabel(role: string): string {
  if (role === "owner") return "dono";
  if (role === "moderator") return "moderador";
  return "participante";
}

function DeviceSelect({
  label,
  kind,
  devices,
  disabled,
  onChange,
}: {
  label: string;
  kind: DeviceKind;
  devices: DeviceOption[];
  disabled: boolean;
  onChange: (kind: DeviceKind, deviceId: string) => void;
}) {
  const options = devices.filter((device) => device.kind === kind);
  const active = options.find((device) => device.active);
  return (
    <label>
      {label}
      <select
        value={active?.deviceId ?? ""}
        disabled={disabled}
        onChange={(event) => {
          onChange(kind, event.currentTarget.value);
        }}
      >
        <option value="">padrão</option>
        {options.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.active ? `${device.label} (ativo)` : device.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function WebInstanceStep({ pending, onRetry }: { pending: boolean; onRetry: () => void }) {
  return (
    <div className="stack">
      <button type="button" disabled={pending} onClick={onRetry}>
        Tentar de novo
      </button>
    </div>
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
      {import.meta.env.DEV ? <a href="?poc=1">Prova de mídia</a> : null}
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
  onChange: (() => void) | null;
  googleLogin: boolean;
  googleWaiting: boolean;
  onGoogle: () => void;
  onCancelGoogle: () => void;
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
      {props.googleLogin && !props.bootstrapOpen ? (
        props.googleWaiting ? (
          <div className="google-wait" role="status">
            <p>Conclua a entrada no navegador que abriu. Esta tela continua sozinha.</p>
            <button type="button" className="ghost" onClick={props.onCancelGoogle}>
              Cancelar
            </button>
          </div>
        ) : (
          <button type="button" className="google" disabled={props.pending} onClick={props.onGoogle}>
            Entrar com Google
          </button>
        )
      ) : null}
      {props.onChange ? (
        <button type="button" onClick={props.onChange}>
          Trocar instância
        </button>
      ) : null}
    </form>
  );
}

function InvitePanel(props: { offer: ShellSnapshot["inviteOffer"]; waiting: string | null; pending: boolean; onAccept: () => void; onDecline: () => void }) {
  if (props.offer) {
    return (
      <section className="invite-offer" role="alertdialog" aria-labelledby="invite-title">
        <h2 id="invite-title">Convite para um servidor</h2>
        {props.offer.sameInstance ? (
          <p>
            O convite é desta instância, <strong>{props.offer.host}</strong>. Aceitar coloca você no servidor. Nenhuma sala é aberta.
          </p>
        ) : (
          <p>
            O convite é de outra instância: <strong>{props.offer.host}</strong>. Aceitar sai da conta atual e abre essa instância. Só entre com sua senha se
            você confia nesse endereço.
          </p>
        )}
        <div className="row">
          <button type="button" className="primary" disabled={props.pending} onClick={props.onAccept}>
            {props.offer.sameInstance ? "Aceitar convite" : `Abrir ${props.offer.host}`}
          </button>
          <button type="button" className="ghost" onClick={props.onDecline}>
            Recusar
          </button>
        </div>
      </section>
    );
  }
  if (props.waiting) {
    return <p className="invite-waiting">Entre na conta de {props.waiting} para aceitar o convite.</p>;
  }
  return null;
}
