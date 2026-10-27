import {
  BLUR_RADIUS_DEFAULT,
  BLUR_RADIUS_MAX,
  BLUR_RADIUS_MIN,
  browserLabel,
  buildCards,
  clampBlurRadius,
  DEFAULT_PLAYBACK,
  describeMediaError,
  emptyStats,
  formatElapsed,
  isVoiceEffect,
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
  type VoiceEffect,
} from "@openmeet/media";
import {
  inviteFromFragment,
  invitePageLink,
  MeetingModel,
  type InstanceApi,
  type ServerPresenceMember,
  type SessionBroker,
  type ShellSnapshot,
  mentionsUser,
  parseChatMessage,
} from "@openmeet/shared";
import desktopPackage from "../../package.json";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { holdMeetingLock } from "../shell/background";
import { CardStage } from "./Cards";
import { Face, ImagePicker } from "./images";
import { SoundPanel, storedSoundVolume } from "./sounds";
import {
  IconCamera,
  IconClock,
  IconGear,
  IconHangUp,
  IconHash,
  IconHeadphones,
  IconLogo,
  IconMic,
  IconPlus,
  IconScreen,
  IconSignal,
  IconSpeaker,
  IconTrash,
  IconUsers,
} from "./Icons";
import { ShellConsent } from "../shell/ShellConsent";
import {
  createDesktopApi,
  createDesktopBroker,
  createDesktopChatTransport,
  isTauri,
  listenInvite,
  listenShell,
  openGoogleLogin,
  renewDesktopSession,
  setAutostart,
  setShortcutConsent,
  shellStatus,
  shellTracks,
  showWindow,
  takeInvite,
  type ShellStatus,
} from "../shell/native";
import { createFetchApi, createLiveKitMedia } from "./api";
import { prepareGoogleWindow } from "../web/google";
import { createWebSession } from "../web/session";
import { createChatFeed, createChatHub, createWebTransport, type ChatTransport } from "./chat-events";
import { TextRoom, type ChatPerson } from "./TextRoom";

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
  backgroundBlurSupported: false,
  backgroundBlur: false,
  backgroundBlurRadius: BLUR_RADIUS_DEFAULT,
  voiceEffects: ["off"],
  voiceEffect: "off",
  voiceMonitor: false,
  radio: false,
  radioDevice: null,
  soundPlaying: null,
  soundVolume: 1,
  screenAudio: "off",
};

// ADR 0020: names shown in the voice effect picker.
const VOICE_EFFECT_LABEL: Record<VoiceEffect, string> = {
  off: "Sem efeito",
  robot: "Robô",
  radio: "Rádio",
  telephone: "Telefone",
  echo: "Eco",
  cave: "Caverna",
  deep: "Grave",
  chipmunk: "Esquilo",
  monster: "Monstro",
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
  invalid_image: "Use uma imagem PNG, JPEG ou WebP de até 256 KB.",
  invalid_display_name: "O apelido não pode ter caracteres de controle e vai até 80 letras.",
  rate_limited: "Muitas trocas seguidas. Espere um minuto.",
  invalid_emoji: "Use um emoji PNG, GIF ou WebP de até 256 KB.",
  invalid_emoji_name: "O nome do emoji vai de 2 a 32 letras, números ou _.",
  emoji_too_large: "O emoji passa de 256 KB.",
  emoji_limit: "O servidor já tem 50 emojis deste tipo.",
  emoji_name_taken: "Já existe um emoji com este nome no servidor.",
  emoji_not_found: "O emoji não está disponível.",
};

const PRESENCE_MS = 5000;
const PLATFORM_PRESENCE_MS = 20_000;
const AWAY_MS = 5 * 60_000;

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

const BLUR_RADIUS_KEY = "openmeet.blurRadius";

// ADR 0016: only the strength is kept on this PC; the effect itself still starts off.
function storedBlurRadius(): number {
  try {
    const saved = localStorage.getItem(BLUR_RADIUS_KEY);
    return saved === null ? BLUR_RADIUS_DEFAULT : clampBlurRadius(Number(saved));
  } catch {
    return BLUR_RADIUS_DEFAULT;
  }
}

const DEVICE_KEY_PREFIX = "openmeet.device.";
const DEVICE_KINDS: DeviceKind[] = ["audioinput", "audiooutput", "videoinput"];

// F04-12: the device picked in Settings, applied when a call connects. Empty means the system default.
function storedDevice(kind: DeviceKind): string {
  try {
    return localStorage.getItem(DEVICE_KEY_PREFIX + kind) ?? "";
  } catch {
    return "";
  }
}

function storeDevice(kind: DeviceKind, deviceId: string): void {
  try {
    if (deviceId.length === 0) localStorage.removeItem(DEVICE_KEY_PREFIX + kind);
    else localStorage.setItem(DEVICE_KEY_PREFIX + kind, deviceId);
  } catch {
    // The choice still holds for this call.
  }
}

/** Outside a call the session has no list; ask the browser and mark the saved picks. */
async function listIdleDevices(): Promise<DeviceOption[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const found = await navigator.mediaDevices.enumerateDevices();
  const counts: Partial<Record<DeviceKind, number>> = {};
  const options: DeviceOption[] = [];
  for (const device of found) {
    const kind = device.kind as DeviceKind;
    if (!DEVICE_KINDS.includes(kind) || device.deviceId.length === 0 || device.deviceId === "default") continue;
    const count = (counts[kind] ?? 0) + 1;
    counts[kind] = count;
    options.push({ deviceId: device.deviceId, label: device.label || `Dispositivo ${count}`, kind, active: device.deviceId === storedDevice(kind) });
  }
  return options;
}

// ADR 0014: the web build has one instance, the origin that served the page. `__WEB__` is replaced at
// build time (vite.config.ts), so the branches of the other target leave the bundle.
function platform(): { api: InstanceApi; broker: SessionBroker | undefined } {
  if (__WEB__) return createWebSession();
  return { api: isTauri() ? createDesktopApi(createFetchApi()) : createFetchApi(), broker: isTauri() ? createDesktopBroker() : undefined };
}

// ADR 0024: the chat stream needs the session where it lives: the cookie on the web, the native process in
// the .exe. A plain browser on the desktop build (dev) has neither, so it gets no live feed.
function chatTransport(origin: string, broker: SessionBroker | undefined): { transport: ChatTransport; renew: () => Promise<boolean> } | null {
  if (__WEB__) {
    return {
      transport: createWebTransport(origin),
      renew: async () => (await broker?.refresh(origin))?.status === 200,
    };
  }
  if (!isTauri()) return null;
  return { transport: createDesktopChatTransport(origin), renew: () => renewDesktopSession(origin) };
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
  const [roomChannel, setRoomChannel] = useState<"voice" | "text">("voice");
  const [textRoomId, setTextRoomId] = useState<string | null>(null);
  const [chatHub] = useState(createChatHub);
  // ADR 0024: mentions that arrived in a room not on screen. Kept only in memory until reads land (F13-13).
  const [mentionCounts, setMentionCounts] = useState<Record<string, number>>({});
  const openTextRef = useRef<string | null>(null);
  openTextRef.current = textRoomId;
  const brokerRef = useRef<SessionBroker | undefined>(undefined);
  const [serverName, setServerName] = useState("");
  const [pastedInvite, setPastedInvite] = useState("");
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState<"server" | "room" | null>(null);
  const [layout, setLayout] = useState<CardLayout>("spotlight");
  const [mobileRooms, setMobileRooms] = useState(true);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  // ADR 0013: only this PC, only during the call, never saved.
  const [deafened, setDeafened] = useState(false);
  const [shareAudio, setShareAudio] = useState(storedShareAudio);
  const [microphoneVolume, setMicrophoneVolume] = useState(100);
  // ADR 0022: the input picked for the radio before turning it on.
  const [radioInput, setRadioInput] = useState("");
  const [blurRadius, setBlurRadius] = useState(storedBlurRadius);
  const [kickTarget, setKickTarget] = useState<{ roomId: string; userId: string; label: string } | null>(null);
  // ADR 0023: removing a room or a server always asks first.
  const [removeTarget, setRemoveTarget] = useState<{ kind: "room" | "server"; id: string; label: string } | null>(null);
  const [levels, setLevels] = useState<Record<string, PlaybackLevel>>({});
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [controlPending, setControlPending] = useState(false);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [shell, setShell] = useState<ShellStatus | null>(null);
  const [shellPending, setShellPending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [nickname, setNickname] = useState("");
  const [membersOpen, setMembersOpen] = useState(() => !__WEB__ || window.innerWidth > 900);
  const [exportConsent, setExportConsent] = useState(false);
  const [idleDevices, setIdleDevices] = useState<DeviceOption[]>([]);
  const devicesApplied = useRef(false);
  const [activity, setActivity] = useState<"online" | "away">("online");
  const mediaRef = useRef(media);
  mediaRef.current = media;

  function session(): LiveKitPocSession {
    if (sessionRef.current === null) {
      sessionRef.current = new LiveKitPocSession({
        appVersion: desktopPackage.version,
        client: __WEB__ ? "web" : "desktop",
        videoBackground: { blurRadius: storedBlurRadius() },
      });
      sessionRef.current.setSoundVolume(storedSoundVolume());
    }
    return sessionRef.current;
  }

  if (modelRef.current === null) {
    const { api, broker } = platform();
    brokerRef.current = broker;
    modelRef.current = new MeetingModel(api, createLiveKitMedia(session), broker, undefined, __WEB__ ? invitePageLink : undefined);
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
    if (!__WEB__) return;
    // ADR 0014: the invite page hands the code over in the fragment. It leaves the address bar at once.
    const code = inviteFromFragment(window.location.hash);
    if (code !== null) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    void model.confirmInstance(window.location.origin).then(() => {
      if (code !== null) model.offerInvite(invitePageLink(window.location.origin, code));
    });
  }, [model]);
  const presenceKey = state.step === "rooms" || state.step === "meeting" ? `${state.selectedServerId ?? ""}:${state.activeRoomId ?? ""}` : null;
  const chatOrigin = (state.step === "rooms" || state.step === "meeting") && state.userId !== null ? state.origin : null;
  useEffect(() => {
    if (chatOrigin === null) return;
    const link = chatTransport(chatOrigin, brokerRef.current);
    if (link === null) return;
    const feed = createChatFeed(link.transport, { renew: link.renew, event: chatHub.event, reset: chatHub.reset });
    return () => feed.close();
  }, [chatHub, chatOrigin]);
  const selfId = state.userId;
  useEffect(
    () =>
      chatHub.subscribe({
        event(name, data) {
          if (name !== "message.created") return;
          const message = parseChatMessage(data);
          if (!message || message.roomId === openTextRef.current || !mentionsUser(message, selfId)) return;
          setMentionCounts((held) => ({ ...held, [message.roomId]: (held[message.roomId] ?? 0) + 1 }));
        },
        reset() {},
      }),
    [chatHub, selfId],
  );
  useEffect(() => {
    if (textRoomId === null) return;
    setMentionCounts((held) => {
      if (held[textRoomId] === undefined) return held;
      const rest = { ...held };
      delete rest[textRoomId];
      return rest;
    });
  }, [textRoomId]);
  useEffect(() => {
    if (presenceKey === null) return;
    void model.refreshPresence();
    const timer = window.setInterval(() => void model.refreshPresence(), PRESENCE_MS);
    return () => window.clearInterval(timer);
  }, [model, presenceKey]);
  useEffect(() => {
    if (state.step !== "rooms" && state.step !== "meeting") return;
    let awayTimer: number | undefined;
    let lastReset = 0;
    const markAway = () => setActivity("away");
    const markActive = () => {
      if (document.hidden) return;
      const now = Date.now();
      if (now - lastReset < 15_000) return;
      lastReset = now;
      setActivity("online");
      if (awayTimer !== undefined) window.clearTimeout(awayTimer);
      awayTimer = window.setTimeout(markAway, AWAY_MS);
    };
    const visibility = () => {
      if (document.hidden) markAway();
      else {
        lastReset = 0;
        markActive();
      }
    };
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "mousemove", "touchstart"];
    events.forEach((event) => window.addEventListener(event, markActive, { passive: true }));
    document.addEventListener("visibilitychange", visibility);
    markActive();
    return () => {
      if (awayTimer !== undefined) window.clearTimeout(awayTimer);
      events.forEach((event) => window.removeEventListener(event, markActive));
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [state.step]);
  useEffect(() => {
    if ((state.step !== "rooms" && state.step !== "meeting") || state.selectedServerId === null) return;
    void model.refreshServerPresence(activity);
    const timer = window.setInterval(() => void model.refreshServerPresence(activity), PLATFORM_PRESENCE_MS);
    return () => window.clearInterval(timer);
  }, [model, state.step, state.selectedServerId, state.servers.length, activity]);
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
    function closeMenus(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      document.querySelectorAll<HTMLDetailsElement>("details.account-menu[open], details.more[open]").forEach((menu) => {
        if (!menu.contains(target)) menu.open = false;
      });
    }
    document.addEventListener("pointerdown", closeMenus);
    return () => document.removeEventListener("pointerdown", closeMenus);
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
  // ADR 0019: the member list of the selected server carries nickname and avatar. A call in another
  // server keeps the LiveKit name and the initial.
  const selfMember = state.serverPresence?.members.find((member) => member.self);
  const memberById = new Map((state.serverPresence?.members ?? []).map((member) => [member.id, member]));
  const textRoom = state.rooms.find((room) => room.id === textRoomId && room.channel === "text");
  const chatPerson = (id: string): ChatPerson => {
    const member = memberById.get(id);
    return member ? { label: member.label, avatarId: member.avatarId } : { label: "Ex-membro", avatarId: null };
  };
  const callMembers = inCall && state.activeServerId === state.selectedServerId ? memberById : new Map<string, ServerPresenceMember>();
  const browsingAway = inCall && state.activeServerId !== null && state.activeServerId !== state.selectedServerId;
  const caption = screenCaption(localScreenSurface(media.tiles), media.screen);
  const isFullscreen = inCall && fullscreen && layout === "spotlight";
  const activeServer = state.servers.find((server) => server.id === state.activeServerId);
  const toggleMicrophone = () => void runControl("microphone", () => session().setMicrophone(!media.microphone));
  const toggleCamera = () => void runControl("camera", () => session().setCamera(!media.camera));
  const toggleScreen = () => void runControl("screen", () => session().setScreenShare(screenShareAction(media.screen) === "start", shareAudio));
  const toggleDeafen = () => setDeafened((current) => !current);
  const leaveCall = () => {
    setMobileRooms(true);
    setMediaError(null);
    model.leaveRoom();
  };

  useEffect(() => {
    if (pinnedId !== null && pin === null) setPinnedId(null);
  }, [pinnedId, pin]);
  useEffect(() => {
    if (!settingsOpen || inCall) return;
    let live = true;
    listIdleDevices()
      .then((options) => live && setIdleDevices(options))
      .catch(() => live && setIdleDevices([]));
    return () => {
      live = false;
    };
  }, [settingsOpen, inCall]);
  useEffect(() => {
    // F04-12: once per call, switch to the devices saved in Settings that this PC still has.
    if (!inCall) {
      devicesApplied.current = false;
      return;
    }
    if (devicesApplied.current || media.phase !== "connected" || media.devices.length === 0) return;
    devicesApplied.current = true;
    for (const kind of DEVICE_KINDS) {
      const saved = storedDevice(kind);
      if (kind === "audiooutput" && !session().browser.outputSelection) continue;
      if (media.devices.some((device) => device.kind === kind && device.deviceId === saved && !device.active)) {
        void session()
          .selectDevice(kind, saved)
          .catch(() => setMediaError("Não foi possível usar o dispositivo salvo nas configurações."));
      }
    }
  }, [inCall, media.phase, media.devices]);
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
  useEffect(() => {
    setServerSettingsOpen(false);
    model.clearCreatedInvite();
  }, [model, state.selectedServerId]);
  useEffect(() => {
    if (creating !== "server" && !serverSettingsOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setCreating(null);
      setServerSettingsOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [creating, serverSettingsOpen]);

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
    storeDevice(kind, deviceId);
    if (!inCall) {
      setIdleDevices((current) => current.map((device) => (device.kind === kind ? { ...device, active: device.deviceId === deviceId } : device)));
      return;
    }
    if (deviceId.length === 0) return;
    void runControl("device", () => session().selectDevice(kind, deviceId));
  }

  async function refreshDevices(): Promise<void> {
    setMediaError(null);
    try {
      if (inCall) await session().refreshDevices();
      else setIdleDevices(await listIdleDevices());
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
        onAutostart={(enabled) => {
          setShellPending(true);
          void setAutostart(enabled)
            .then(setShell)
            .catch(() => {
              setMediaError("Não foi possível alterar o início com o Windows.");
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
      web={__WEB__}
      onAccept={() => void model.acceptInvite()}
      onDecline={() => model.declineInvite()}
    />
  );

  if (state.step === "instance" || state.step === "account") {
    return (
      <main className={`auth-shell${__WEB__ ? " web-auth" : ""}`}>
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
                onGoogle={() => {
                  if (!__WEB__) {
                    void model.loginWithGoogle(openGoogleLogin);
                    return;
                  }
                  const google = prepareGoogleWindow();
                  void model.loginWithGoogle(google.open).finally(google.dispose);
                }}
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
    <main
      className={`server-shell${__WEB__ ? " web-shell" : ""}${mobileRooms ? " mobile-rooms" : " mobile-call"}${membersOpen ? " members-open" : " members-closed"}${isFullscreen ? " is-fullscreen" : ""}`}
    >
      {__WEB__ ? (
        <header className="mobile-navigation">
          <nav aria-label="Navegação da reunião">
            <button
              type="button"
              aria-pressed={mobileRooms}
              onClick={() => {
                setMobileRooms(true);
                setFullscreen(false);
              }}
            >
              Salas
            </button>
            <button type="button" aria-pressed={!mobileRooms} disabled={!inCall && !kickTarget && !textRoom} onClick={() => setMobileRooms(false)}>
              {textRoom ? `#${textRoom.name}` : inCall ? "Voltar à chamada" : "Chamada"}
            </button>
          </nav>
          {mobileRooms && notice ? (
            <p className="error" role="status">
              {notice}
            </p>
          ) : null}
          {mobileRooms ? invitePanel : null}
        </header>
      ) : null}
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
            <Face origin={state.origin} imageId={server.iconId} label={server.name} />
          </button>
        ))}
        <button
          type="button"
          className="server-pill add"
          title="Adicionar servidor"
          aria-label="Adicionar servidor"
          onClick={() => setCreating(creating === "server" ? null : "server")}
        >
          <IconPlus size={22} />
        </button>
      </nav>

      <aside className="room-bar">
        <header className="room-bar-head">
          <div>
            <strong>{selectedServer?.name ?? state.instanceName ?? "OpenMeet"}</strong>
            {selectedServer ? <span>{roleLabel(selectedServer.role)}</span> : null}
          </div>
          <div className="room-head-actions">
            {selectedServer ? (
              <button
                type="button"
                className="icon-btn mobile-members-button"
                aria-label="Mostrar membros"
                title="Mostrar membros"
                onClick={() => setMembersOpen(true)}
              >
                <IconUsers size={18} />
              </button>
            ) : null}
            {selectedServer && state.canCreate ? (
              <button
                type="button"
                className="icon-btn"
                aria-label="Criar sala"
                title="Criar sala"
                onClick={() => setCreating(creating === "room" ? null : "room")}
              >
                <IconPlus size={18} />
              </button>
            ) : null}
            {selectedServer && (selectedServer.role === "owner" || selectedServer.role === "moderator") ? (
              <button
                type="button"
                className="icon-btn"
                aria-label="Configurações do servidor"
                title="Configurações do servidor"
                onClick={() => setServerSettingsOpen(true)}
              >
                <IconGear size={18} />
              </button>
            ) : null}
          </div>
        </header>
        {state.servers.length === 0 ? (
          <p className="hint">
            {state.canCreateServer ? "Crie o primeiro servidor no botão + à esquerda." : "Você ainda não participa de nenhum servidor. Peça um convite."}
          </p>
        ) : null}
        <ul className="room-list">
          {state.rooms.map((room) => (
            <li key={room.id} className="room-row">
              <button
                type="button"
                className={`room-item${room.id === state.activeRoomId || room.id === textRoom?.id ? " active" : ""}`}
                disabled={room.channel === "text" ? false : state.pending || room.ended || room.id === state.activeRoomId}
                aria-current={room.id === textRoom?.id ? "page" : undefined}
                onClick={() => {
                  if (room.channel === "text") {
                    setTextRoomId(room.id);
                    setMobileRooms(false);
                    return;
                  }
                  setTextRoomId(null);
                  void model.enterRoom(room.id, "").then(() => {
                    if (model.snapshot().activeRoomId === room.id) setMobileRooms(false);
                  });
                }}
              >
                {room.channel === "text" ? <IconHash /> : room.kind === "temporary" ? <IconClock /> : <IconSpeaker />}
                <span className="room-name">{room.name}</span>
                {(mentionCounts[room.id] ?? 0) > 0 ? (
                  <span className="mention-count" aria-label={`${mentionCounts[room.id]} menções`}>
                    {Math.min(mentionCounts[room.id] ?? 0, 99)}
                  </span>
                ) : null}
                {room.ended ? <span className="badge">encerrada</span> : room.kind === "temporary" ? <span className="sr">temporária</span> : null}
              </button>
              {state.canCreate ? (
                <button
                  type="button"
                  className="icon-btn danger-text room-remove"
                  disabled={state.pending}
                  aria-label={`Remover a sala ${room.name}`}
                  title={`Remover a sala ${room.name}`}
                  onClick={() => {
                    setRemoveTarget({ kind: "room", id: room.id, label: room.name });
                    setMobileRooms(false);
                  }}
                >
                  <IconTrash size={16} />
                </button>
              ) : null}
              {(state.presence?.[room.id] ?? []).length > 0 ? (
                <ul className="occupants" aria-label={`Na sala ${room.name}`}>
                  {(state.presence?.[room.id] ?? []).map((person) => {
                    const speaking = room.id === state.activeRoomId && media.speakers.includes(person.id);
                    return (
                      <li key={person.id} className={speaking ? "speaking" : undefined}>
                        <span className="avatar tiny" aria-hidden="true">
                          <span>
                            <Face origin={state.origin} imageId={memberById.get(person.id)?.avatarId ?? null} label={person.label} />
                          </span>
                        </span>
                        <span className="room-name">{person.label}</span>
                        {(state.canCreate || state.role === "admin") && !media.participants.some((p) => p.local && p.identity === person.id) ? (
                          <button
                            type="button"
                            className="icon-btn danger-text"
                            disabled={state.pending}
                            aria-label={`Desconectar ${person.label} da sala`}
                            title={`Desconectar ${person.label} da sala`}
                            onClick={() => {
                              setKickTarget({ roomId: room.id, userId: person.id, label: person.label });
                              setMobileRooms(false);
                            }}
                          >
                            <IconHangUp size={16} />
                          </button>
                        ) : null}
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
          creating === "room" ? (
            <form
              className="inline-form"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                void model.createRoom(roomName, roomSlug, roomChannel === "text" ? "persistent" : roomKind, roomChannel).then(() => {
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
                Canal
                <select value={roomChannel} onChange={(event) => setRoomChannel(event.currentTarget.value === "text" ? "text" : "voice")}>
                  <option value="voice">Voz</option>
                  <option value="text">Texto</option>
                </select>
              </label>
              {roomChannel === "voice" ? (
                <label>
                  Tipo
                  <select value={roomKind} onChange={(event) => setRoomKind(event.currentTarget.value)}>
                    <option value="persistent">Persistente</option>
                    <option value="temporary">Temporária</option>
                  </select>
                </label>
              ) : (
                <p className="hint">Sala de texto guarda as mensagens e é sempre persistente.</p>
              )}
              <div className="row">
                <button type="submit" disabled={state.pending}>
                  Criar sala
                </button>
                <button type="button" className="ghost" onClick={() => setCreating(null)}>
                  Cancelar
                </button>
              </div>
            </form>
          ) : null
        ) : null}
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
            <span>
              <Face origin={state.origin} imageId={selfMember?.avatarId ?? null} label={selfMember?.label ?? state.userLabel ?? "?"} />
            </span>
          </span>
          <div className="you-name">
            <strong>{selfMember?.label ?? state.userLabel}</strong>
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
              {state.serverPresence ? (
                <button
                  type="button"
                  className="ghost"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    setNickname(state.serverPresence?.selfProfile.nickname ?? "");
                    setProfileOpen(true);
                  }}
                >
                  Perfil
                </button>
              ) : null}
              <button type="button" className="ghost" onClick={() => void model.reloadRooms()} disabled={state.pending}>
                Atualizar
              </button>
              <button
                type="button"
                className="ghost"
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  setSettingsOpen(true);
                }}
              >
                Configurações
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

      {membersOpen && selectedServer && state.serverPresence ? (
        <aside className="members-panel" aria-label={`Membros de ${selectedServer.name}`}>
          <header>
            <div>
              <strong>Membros</strong>
              <span>{state.serverPresence.members.length}</span>
            </div>
            <button type="button" className="icon-btn" aria-label="Recolher membros" title="Recolher membros" onClick={() => setMembersOpen(false)}>
              ×
            </button>
          </header>
          <ul>
            {state.serverPresence.members.map((member) => (
              <li key={member.id} title={member.globalName !== member.label ? `Conta: ${member.globalName}` : undefined}>
                <span className="member-avatar" aria-hidden="true">
                  <Face origin={state.origin} imageId={member.avatarId} label={member.label} />
                  <span className={`presence-dot ${member.status}`} />
                </span>
                <span className="member-copy">
                  <strong>{member.label}</strong>
                  <span>{presenceLabel(member.status, member.activity)}</span>
                </span>
              </li>
            ))}
          </ul>
          {state.serverPresence.allowInvisible ? (
            <label className="presence-option member-self-mode">
              <input
                type="checkbox"
                checked={state.serverPresence.selfMode === "invisible"}
                onChange={(event) => void model.setPresenceMode(event.currentTarget.checked ? "invisible" : "visible")}
              />
              Aparecer como invisível
            </label>
          ) : null}
        </aside>
      ) : null}

      <section className="call-area">
        {!membersOpen && selectedServer ? (
          <button type="button" className="members-toggle" aria-label="Mostrar membros" title="Mostrar membros" onClick={() => setMembersOpen(true)}>
            <IconUsers size={19} />
            <span>{state.serverPresence?.members.length ?? 0}</span>
          </button>
        ) : null}
        {kickTarget ? (
          <section className="inline-form" role="alertdialog" aria-label="Desconectar participante">
            <p>Desconectar {kickTarget.label} desta sala? A pessoa continua no servidor e pode entrar novamente.</p>
            <div className="row">
              <button
                type="button"
                className="danger-text"
                disabled={state.pending}
                onClick={() => void model.kickParticipant(kickTarget.roomId, kickTarget.userId).then(() => setKickTarget(null))}
              >
                Desconectar da sala
              </button>
              <button type="button" className="ghost" disabled={state.pending} onClick={() => setKickTarget(null)}>
                Cancelar
              </button>
            </div>
          </section>
        ) : null}
        {removeTarget ? (
          <section className="inline-form" role="alertdialog" aria-label={removeTarget.kind === "room" ? "Remover sala" : "Remover servidor"}>
            <p>
              {removeTarget.kind === "room"
                ? `Remover a sala ${removeTarget.label}? Quem estiver nela será desconectado e os convites deixam de valer.`
                : `Remover o servidor ${removeTarget.label}? Todas as salas serão encerradas, todos os membros perdem o acesso e os convites deixam de valer.`}
            </p>
            <div className="row">
              <button
                type="button"
                className="danger-text"
                disabled={state.pending}
                onClick={() =>
                  void (removeTarget.kind === "room" ? model.deleteRoom(removeTarget.id) : model.deleteServer(removeTarget.id)).then(() =>
                    setRemoveTarget(null),
                  )
                }
              >
                {removeTarget.kind === "room" ? "Remover sala" : "Remover servidor"}
              </button>
              <button type="button" className="ghost" disabled={state.pending} onClick={() => setRemoveTarget(null)}>
                Cancelar
              </button>
            </div>
          </section>
        ) : null}
        {notice ? <p className="error">{notice}</p> : null}
        {invitePanel}
        {mediaError ? <p className="error">{mediaError}</p> : null}
        {textRoom ? (
          <TextRoom
            model={model}
            room={textRoom}
            origin={state.origin}
            userId={state.userId}
            manager={selectedServer?.role === "owner" || selectedServer?.role === "moderator"}
            person={chatPerson}
            members={state.serverPresence?.members ?? []}
            subscribe={chatHub.subscribe}
            onClose={() => {
              setTextRoomId(null);
              if (!inCall) setMobileRooms(true);
            }}
          />
        ) : null}
        {settingsOpen ? (
          <section className="settings-page" aria-labelledby="settings-title">
            <header>
              <div>
                <p className="eyebrow">Aplicativo</p>
                <h1 id="settings-title">Configurações</h1>
              </div>
              <button type="button" className="ghost" onClick={() => setSettingsOpen(false)}>
                Fechar
              </button>
            </header>
            <div className="settings-content">
              <div>
                <h2>Áudio e vídeo</h2>
                <p className="hint">Valem para todas as salas e ficam salvos neste aparelho. Microfone, efeito e rádio ficam nos ajustes da chamada.</p>
              </div>
              <div className="settings-group">
                {session().browser.outputSelection ? (
                  <DeviceSelect
                    label="Saída"
                    kind="audiooutput"
                    devices={inCall ? media.devices : idleDevices}
                    disabled={inCall && (!controlsEnabled || controlPending)}
                    onChange={onDevice}
                  />
                ) : null}
                <DeviceSelect
                  label="Câmera"
                  kind="videoinput"
                  devices={inCall ? media.devices : idleDevices}
                  disabled={inCall && (!controlsEnabled || controlPending)}
                  onChange={onDevice}
                />
                <label className="effect-toggle">
                  <input
                    type="checkbox"
                    checked={media.backgroundBlur}
                    disabled={!media.backgroundBlurSupported || controlPending}
                    onChange={(event) => {
                      const enabled = event.currentTarget.checked;
                      void runControl("blur de fundo", () => session().setBackgroundBlur(enabled));
                    }}
                  />
                  Desfocar fundo da câmera
                </label>
                {media.backgroundBlurSupported ? (
                  <label>
                    Intensidade do desfoque: {blurRadius}
                    <input
                      type="range"
                      min={BLUR_RADIUS_MIN}
                      max={BLUR_RADIUS_MAX}
                      step={1}
                      value={blurRadius}
                      aria-valuetext={`raio ${blurRadius} px`}
                      onChange={(event) => {
                        const value = clampBlurRadius(Number(event.currentTarget.value));
                        setBlurRadius(value);
                        try {
                          localStorage.setItem(BLUR_RADIUS_KEY, String(value));
                        } catch {
                          // The choice still holds for this window.
                        }
                        session()
                          .setBackgroundBlurRadius(value)
                          .catch(() => setMediaError("Não foi possível ajustar o desfoque."));
                      }}
                    />
                  </label>
                ) : null}
                {media.backgroundBlurSupported ? (
                  <p className="hint">O efeito é processado neste aparelho e pode aumentar o uso de bateria.</p>
                ) : (
                  <p className="hint">Este navegador não oferece o processamento necessário para o blur.</p>
                )}
                <button type="button" disabled={inCall && !controlsEnabled} onClick={() => void refreshDevices()}>
                  Atualizar dispositivos
                </button>
              </div>
              {consent ? (
                <>
                  <div>
                    <h2>Atalhos</h2>
                    <p className="hint">Controle os atalhos globais usados pelo OpenMeet neste computador.</p>
                  </div>
                  {consent}
                </>
              ) : null}
              <div>
                <h2>Diagnóstico</h2>
                <p className="hint">Versão e qualidade da conexão, para relatar um problema.</p>
              </div>
              <div className="settings-group">
                <p className="metrics">
                  {browserLabel(session().browser)} · {media.stats.userAgent ?? "user agent indisponível"} · app {media.stats.appVersion ?? "—"}
                </p>
                {inCall && media.stats.available ? (
                  <p className="metrics">
                    perda {media.stats.packetsLost ?? "—"} · jitter {media.stats.jitterMs ?? "—"} ms · RTT {media.stats.rttMs ?? "—"} ms · candidato{" "}
                    {media.stats.candidateType ?? "—"} · saída {media.stats.outboundWidth ?? "—"}x{media.stats.outboundHeight ?? "—"} @{" "}
                    {media.stats.outboundFps ?? "—"} fps · superfície {media.stats.displaySurface ?? "—"}
                  </p>
                ) : (
                  <p className="metrics">{inCall ? "Métricas ainda não disponíveis." : "As métricas aparecem durante uma chamada."}</p>
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
            </div>
          </section>
        ) : null}
        {creating === "server" ? (
          <div className="modal-backdrop" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && setCreating(null)}>
            <section className="app-modal" role="dialog" aria-modal="true" aria-labelledby="add-server-title">
              <header>
                <div>
                  <h1 id="add-server-title">Adicionar servidor</h1>
                  <p>Crie um espaço novo ou entre usando um convite.</p>
                </div>
                <button type="button" className="icon-btn" aria-label="Fechar" onClick={() => setCreating(null)}>
                  ×
                </button>
              </header>
              {state.canCreateServer ? (
                <form
                  className="modal-section"
                  onSubmit={(event: FormEvent) => {
                    event.preventDefault();
                    void model.createServer(serverName).then(() => {
                      setServerName("");
                      setCreating(null);
                    });
                  }}
                >
                  <div>
                    <h2>Criar servidor</h2>
                    <p className="hint">Você será o dono e poderá criar salas e convites.</p>
                  </div>
                  <label>
                    Nome do servidor
                    <input value={serverName} onChange={(event) => setServerName(event.currentTarget.value)} maxLength={80} autoFocus />
                  </label>
                  <button type="submit" className="primary" disabled={state.pending || serverName.trim().length === 0}>
                    Criar servidor
                  </button>
                </form>
              ) : null}
              <form
                className="modal-section"
                onSubmit={(event: FormEvent) => {
                  event.preventDefault();
                  model.offerInvite(pastedInvite);
                  setPastedInvite("");
                  setCreating(null);
                }}
              >
                <div>
                  <h2>Entrar com convite</h2>
                  <p className="hint">Cole o link ou o código recebido.</p>
                </div>
                <label>
                  Convite
                  <input
                    value={pastedInvite}
                    onChange={(event) => setPastedInvite(event.currentTarget.value)}
                    placeholder="Link ou código do convite"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <button type="submit" disabled={state.pending || pastedInvite.trim().length === 0}>
                  Entrar no servidor
                </button>
              </form>
            </section>
          </div>
        ) : null}
        {profileOpen && selectedServer && state.serverPresence ? (
          <div className="modal-backdrop" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && setProfileOpen(false)}>
            <section className="app-modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
              <header>
                <div>
                  <h1 id="profile-title">Perfil</h1>
                  <p>A foto da conta vale em todos os servidores. Cada servidor pode ter apelido e foto próprios.</p>
                </div>
                <button type="button" className="icon-btn" aria-label="Fechar" onClick={() => setProfileOpen(false)}>
                  ×
                </button>
              </header>
              <section className="modal-section">
                <h2>Conta</h2>
                <div className="image-row">
                  <span className="profile-face" aria-hidden="true">
                    <Face origin={state.origin} imageId={state.serverPresence.selfProfile.globalAvatarId} label={state.userLabel ?? "?"} />
                  </span>
                  <div className="image-copy">
                    <strong>{state.userLabel}</strong>
                    <div className="row">
                      <ImagePicker
                        label="Trocar foto"
                        disabled={state.pending}
                        onPick={(image) => void model.setAccountAvatar(image)}
                        onError={setMediaError}
                      />
                      {state.serverPresence.selfProfile.globalAvatarId ? (
                        <button type="button" className="ghost danger-text" disabled={state.pending} onClick={() => void model.setAccountAvatar(null)}>
                          Remover
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </section>
              <section className="modal-section">
                <div>
                  <h2>Em {selectedServer.name}</h2>
                  <p className="hint">Sem apelido ou foto aqui, vale o perfil da conta.</p>
                </div>
                <div className="image-row">
                  <span className="profile-face" aria-hidden="true">
                    <Face
                      origin={state.origin}
                      imageId={state.serverPresence.selfProfile.avatarId ?? state.serverPresence.selfProfile.globalAvatarId}
                      label={state.serverPresence.selfProfile.nickname ?? state.userLabel ?? "?"}
                    />
                  </span>
                  <div className="row">
                    <ImagePicker
                      label="Foto só aqui"
                      disabled={state.pending}
                      onPick={(avatar) => void model.setServerProfile({ avatar })}
                      onError={setMediaError}
                    />
                    {state.serverPresence.selfProfile.avatarId ? (
                      <button
                        type="button"
                        className="ghost danger-text"
                        disabled={state.pending}
                        onClick={() => void model.setServerProfile({ avatar: null })}
                      >
                        Remover
                      </button>
                    ) : null}
                  </div>
                </div>
                <form
                  className="nickname-form"
                  onSubmit={(event: FormEvent) => {
                    event.preventDefault();
                    void model.setServerProfile({ nickname: nickname.trim() === "" ? null : nickname });
                  }}
                >
                  <label>
                    Apelido
                    <input value={nickname} onChange={(event) => setNickname(event.currentTarget.value)} maxLength={80} placeholder={state.userLabel ?? ""} />
                  </label>
                  <div className="row">
                    <button type="submit" disabled={state.pending || nickname.trim() === (state.serverPresence.selfProfile.nickname ?? "")}>
                      Salvar apelido
                    </button>
                    {state.serverPresence.selfProfile.nickname !== null || state.serverPresence.selfProfile.avatarId !== null ? (
                      <button
                        type="button"
                        className="ghost"
                        disabled={state.pending}
                        onClick={() => {
                          setNickname("");
                          void model.setServerProfile({ nickname: null, avatar: null });
                        }}
                      >
                        Usar perfil da conta
                      </button>
                    ) : null}
                  </div>
                </form>
              </section>
            </section>
          </div>
        ) : null}
        {serverSettingsOpen && selectedServer && state.serverPresence ? (
          <div className="modal-backdrop" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && setServerSettingsOpen(false)}>
            <section className="app-modal server-settings-modal" role="dialog" aria-modal="true" aria-labelledby="server-settings-title">
              <header>
                <div>
                  <h1 id="server-settings-title">Configurações de {selectedServer.name}</h1>
                  <p>Gerencie convites e a privacidade de presença deste servidor.</p>
                </div>
                <button type="button" className="icon-btn" aria-label="Fechar" onClick={() => setServerSettingsOpen(false)}>
                  ×
                </button>
              </header>
              <section className="modal-section">
                <div>
                  <h2>Convite</h2>
                  <p className="hint">O link vale por 24 horas e pode ser usado até 10 vezes.</p>
                </div>
                {state.createdInvite ? (
                  <div className="invite-out">
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
                        Gerar outro
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="primary modal-action"
                    disabled={state.pending}
                    onClick={() => {
                      setCopied(false);
                      void model.createInvite();
                    }}
                  >
                    Criar link de convite
                  </button>
                )}
              </section>
              {selectedServer.role === "owner" ? (
                <section className="modal-section">
                  <div>
                    <h2>Ícone</h2>
                    <p className="hint">Aparece na barra de servidores para todos os membros. PNG, JPEG ou WebP.</p>
                  </div>
                  <div className="image-row">
                    <span className="profile-face server-face" aria-hidden="true">
                      <Face origin={state.origin} imageId={selectedServer.iconId} label={selectedServer.name} />
                    </span>
                    <ImagePicker label="Escolher imagem" disabled={state.pending} onPick={(image) => void model.setServerIcon(image)} onError={setMediaError} />
                    {selectedServer.iconId ? (
                      <button type="button" className="ghost danger-text" disabled={state.pending} onClick={() => void model.setServerIcon(null)}>
                        Remover
                      </button>
                    ) : null}
                  </div>
                </section>
              ) : null}
              {selectedServer.role === "owner" ? (
                <section className="modal-section">
                  <div>
                    <h2>Privacidade de presença</h2>
                    <p className="hint">Defina se membros podem ficar invisíveis e quem pode identificá-los.</p>
                  </div>
                  <label className="presence-option">
                    <input
                      type="checkbox"
                      checked={state.serverPresence.allowInvisible}
                      onChange={(event) => void model.setPresencePolicy(event.currentTarget.checked, state.serverPresence?.managersSeeInvisible ?? false)}
                    />
                    Permitir modo invisível
                  </label>
                  <label className="presence-option">
                    <input
                      type="checkbox"
                      checked={state.serverPresence.managersSeeInvisible}
                      disabled={!state.serverPresence.allowInvisible}
                      onChange={(event) => void model.setPresencePolicy(true, event.currentTarget.checked)}
                    />
                    Dono e moderadores podem identificar membros invisíveis
                  </label>
                </section>
              ) : null}
              {selectedServer.role === "owner" ? (
                <section className="modal-section">
                  <div>
                    <h2>Remover servidor</h2>
                    <p className="hint">Encerra todas as salas e tira o acesso de todos os membros.</p>
                  </div>
                  <div className="row">
                    <button
                      type="button"
                      className="danger-text"
                      disabled={state.pending}
                      onClick={() => {
                        setRemoveTarget({ kind: "server", id: selectedServer.id, label: selectedServer.name });
                        setServerSettingsOpen(false);
                      }}
                    >
                      Remover servidor
                    </button>
                  </div>
                </section>
              ) : null}
            </section>
          </div>
        ) : null}
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
              cards={cards.map((card) => {
                const member = callMembers.get(card.identity);
                return member ? { ...card, label: member.label } : card;
              })}
              origin={state.origin}
              avatarFor={(identity) => callMembers.get(identity)?.avatarId ?? null}
              accountFor={(identity) => callMembers.get(identity)?.globalName ?? null}
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
              {session().browser.screenAudio ? (
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
              ) : null}
              {!isFullscreen ? (
                <SoundPanel
                  model={model}
                  session={session}
                  origin={state.origin}
                  serverId={state.activeServerId}
                  servers={state.servers}
                  playing={media.soundPlaying}
                  volume={media.soundVolume}
                  onError={setMediaError}
                />
              ) : null}
              {isFullscreen ? (
                <button type="button" className="ghost" onClick={() => setFullscreen(false)}>
                  Sair da tela cheia
                </button>
              ) : (
                <details
                  className="more"
                  onToggle={(event) => {
                    // "Ouvir minha voz" only lives while the panel is open.
                    if (!event.currentTarget.open && media.voiceMonitor) session().setVoiceMonitor(false);
                  }}
                >
                  <summary className="ctl" aria-label="Dispositivos e diagnóstico" title="Dispositivos e diagnóstico">
                    <IconGear size={22} />
                  </summary>
                  <div className="more-body">
                    <button
                      type="button"
                      className="mobile-close ghost"
                      onClick={(event) => {
                        const menu = event.currentTarget.closest("details");
                        if (menu) {
                          menu.open = false;
                          menu.querySelector("summary")?.focus();
                        }
                      }}
                    >
                      Fechar ajustes
                    </button>
                    <DeviceSelect label="Entrada" kind="audioinput" devices={media.devices} disabled={!controlsEnabled || controlPending} onChange={onDevice} />
                    <label>
                      Volume de entrada do microfone: {microphoneVolume}%
                      <input
                        type="range"
                        min={0}
                        max={200}
                        step={1}
                        value={microphoneVolume}
                        disabled={!controlsEnabled || controlPending}
                        aria-valuetext={`${microphoneVolume}%`}
                        onChange={(event) => {
                          const value = Number(event.currentTarget.value);
                          session().setMicrophoneVolume(value / 100);
                          setMicrophoneVolume(value);
                        }}
                      />
                    </label>
                    <p className="hint">100% mantém o nível original. Acima disso, o som pode distorcer. 0% corta sua voz.</p>
                    <label>
                      Efeito de voz
                      <select
                        value={media.voiceEffect}
                        disabled={controlPending}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          if (!isVoiceEffect(value)) return;
                          session()
                            .setVoiceEffect(value)
                            .catch(() => setMediaError("Não foi possível aplicar o efeito de voz. Sua voz segue sem efeito."));
                        }}
                      >
                        {media.voiceEffects.map((effect) => (
                          <option key={effect} value={effect}>
                            {VOICE_EFFECT_LABEL[effect]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="effect-toggle">
                      <input type="checkbox" checked={media.voiceMonitor} onChange={(event) => session().setVoiceMonitor(event.currentTarget.checked)} />
                      Ouvir minha voz
                    </label>
                    <p className="hint">Todos na sala ouvem o efeito. Para se ouvir, use fone: no alto-falante a voz volta para o microfone.</p>
                    {(() => {
                      // ADR 0022: an input of this PC played to the room as its own card.
                      const inputs = media.devices.filter((device) => device.kind === "audioinput");
                      const micId = inputs.find((device) => device.active)?.deviceId ?? null;
                      const chosen = media.radio ? (media.radioDevice ?? "") : radioInput || (inputs.find((device) => !device.active)?.deviceId ?? "");
                      return (
                        <fieldset className="radio-controls">
                          <legend>Rádio</legend>
                          <label>
                            Entrada do rádio
                            <select
                              value={chosen}
                              disabled={!controlsEnabled || controlPending || inputs.length === 0}
                              onChange={(event) => {
                                const value = event.currentTarget.value;
                                setRadioInput(value);
                                if (media.radio) void runControl("rádio", () => session().setRadio(value));
                              }}
                            >
                              {inputs.map((device) => (
                                <option key={device.deviceId} value={device.deviceId}>
                                  {device.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            className={media.radio ? "on" : ""}
                            disabled={!controlsEnabled || controlPending || chosen === ""}
                            onClick={() => void runControl("rádio", () => session().setRadio(media.radio ? null : chosen))}
                          >
                            {media.radio ? "Desligar rádio" : "Ligar rádio"}
                          </button>
                          {chosen !== "" && chosen === micId ? (
                            <p className="hint">Essa é a mesma entrada do microfone: sua voz iria junto com a música.</p>
                          ) : null}
                          <p className="hint">
                            Mande o som do player para um cabo virtual (como o VB-Audio Cable) e escolha-o aqui. Mixagem estéreo também leva a sala de volta e
                            gera eco. O que toca é responsabilidade de quem liga o rádio.
                          </p>
                        </fieldset>
                      );
                    })()}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.currentTarget.closest("details")?.removeAttribute("open");
                        setSettingsOpen(true);
                      }}
                    >
                      Saída, câmera e diagnóstico
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

function presenceLabel(status: "online" | "away" | "offline" | "invisible", activity: "online" | "away" | null): string {
  if (status === "online") return "online";
  if (status === "away") return "ausente";
  if (status === "invisible") return activity === "away" ? "invisível · ausente" : "invisível";
  return "desconectado";
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

function InvitePanel(props: {
  offer: ShellSnapshot["inviteOffer"];
  waiting: string | null;
  pending: boolean;
  web: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  // ADR 0014: this page talks only to its own instance. An invite from another one opens at that address.
  if (props.offer && props.web && !props.offer.sameInstance) {
    return (
      <section className="invite-offer" role="alertdialog" aria-labelledby="invite-title">
        <h2 id="invite-title">Convite de outra instância</h2>
        <p>
          O convite é de <strong>{props.offer.host}</strong>. Abra o link do convite no navegador para entrar por esse endereço.
        </p>
        <div className="row">
          <button type="button" className="ghost" onClick={props.onDecline}>
            Fechar
          </button>
        </div>
      </section>
    );
  }
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
