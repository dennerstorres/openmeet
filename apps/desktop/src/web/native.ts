import { prepareInstanceRequest, titleWithCount } from "@openmeet/shared";
import type * as Native from "../shell/native";

// ADR 0014: the web build resolves `../shell/native` to this file (see vite.config.ts). Tray, global
// shortcuts, native notification, the vault and openmeet:// do not exist in the browser, so none of their
// commands reach the bundle. The signatures stay those of the desktop module.

export type { ShellStatus, ShortcutView } from "../shell/native";

export const isTauri: typeof Native.isTauri = () => false;

export const createDesktopBroker: typeof Native.createDesktopBroker = () => {
  throw new Error("no native session in the browser");
};

export const createDesktopApi: typeof Native.createDesktopApi = (open) => open;

export const shellStatus: typeof Native.shellStatus = () => Promise.reject(new Error("no shell in the browser"));

export const setShortcutConsent: typeof Native.setShortcutConsent = () => Promise.reject(new Error("no shell in the browser"));

export const setAutostart: typeof Native.setAutostart = () => Promise.reject(new Error("no shell in the browser"));

export const shellTracks: typeof Native.shellTracks = async () => undefined;

export const checkUpdate: typeof Native.checkUpdate = async () => null;

export const installUpdate: typeof Native.installUpdate = () => Promise.reject(new Error("no updater in the browser"));

export const showWindow: typeof Native.showWindow = async () => undefined;

export const listenShell: typeof Native.listenShell = async () => () => undefined;

export const takeInvite: typeof Native.takeInvite = async () => null;

export const listenInvite: typeof Native.listenInvite = async () => () => undefined;

/** ADR 0014: Google opens in a new browser window; the page keeps polling. */
export const openGoogleLogin: typeof Native.openGoogleLogin = async (url) => {
  window.open(url, "_blank", "noopener,noreferrer");
};

/** ADR 0019: same-origin image read with the session cookie and the web header, like every web call. */
export const fetchImage: typeof Native.fetchImage = async (origin, id) => {
  const prepared = prepareInstanceRequest(origin, origin, "GET", `/api/v1/images/${id}`, null, null);
  const response = await fetch(prepared.url, {
    headers: { "x-openmeet-web": "1" },
    credentials: "same-origin",
    redirect: "error",
  });
  if (response.status !== 200) throw new Error("image_not_found");
  return new Uint8Array(await response.arrayBuffer());
};

/** ADR 0024: same-origin read of a server emoji; the page checks the bytes before showing them. */
export const fetchEmoji: typeof Native.fetchEmoji = async (origin, id) => {
  const prepared = prepareInstanceRequest(origin, origin, "GET", `/api/v1/emojis/${id}`, null, null);
  const response = await fetch(prepared.url, {
    headers: { "x-openmeet-web": "1" },
    credentials: "same-origin",
    redirect: "error",
  });
  if (response.status !== 200) throw new Error("emoji_not_found");
  return new Uint8Array(await response.arrayBuffer());
};

/** ADR 0021: same-origin sound read with the session cookie and the web header. */
export const fetchSound: typeof Native.fetchSound = async (origin, id) => {
  const prepared = prepareInstanceRequest(origin, origin, "GET", `/api/v1/sounds/${id}`, null, null);
  const response = await fetch(prepared.url, {
    headers: { "x-openmeet-web": "1" },
    credentials: "same-origin",
    redirect: "error",
  });
  if (response.status !== 200) throw new Error("sound_not_found");
  return new Uint8Array(await response.arrayBuffer());
};

async function attachmentBytes(origin: string, id: string): Promise<Blob> {
  const prepared = prepareInstanceRequest(origin, origin, "GET", `/api/v1/attachments/${id}`, null, null);
  const response = await fetch(prepared.url, {
    headers: { "x-openmeet-web": "1" },
    credentials: "same-origin",
    redirect: "error",
  });
  if (response.status !== 200) throw new Error("attachment_not_found");
  return response.blob();
}

/** ADR 0024: same-origin read of a sent picture; the page checks the bytes before showing them. */
export const fetchAttachment: typeof Native.fetchAttachment = async (origin, id) => new Uint8Array(await (await attachmentBytes(origin, id)).arrayBuffer());

/**
 * ADR 0024: the browser saves it as a download. The blob is re-typed as octet-stream so the browser
 * neither guesses nor opens it, whatever the name says.
 */
export const saveAttachment: typeof Native.saveAttachment = async (origin, id, name) => {
  const blob = new Blob([await (await attachmentBytes(origin, id)).arrayBuffer()], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return name;
};

// ADR 0024: the web reads the chat stream with fetch (meeting/chat-events.ts); there is no native one.
export const createDesktopChatTransport: typeof Native.createDesktopChatTransport = () => ({
  open: (_lastEventId, _event, closed) => {
    queueMicrotask(() => closed(0));
    return () => undefined;
  },
});

export const renewDesktopSession: typeof Native.renewDesktopSession = async () => false;

// A new tab without access back to this page; the address was already limited to http and https.
export const openChatLink: typeof Native.openChatLink = async (url) => {
  window.open(url, "_blank", "noopener,noreferrer");
};

// ADR 0024 (F13-13): on the web the count goes to the tab title and a dot on the favicon, and the browser's
// Notification only shows after the person turned it on in Settings, which is when permission is asked.
const NOTIFY_KEY = "openmeet.webNotifications";
const BASE_ICON = "/icon.svg";
const openChatHandlers = new Set<(chat: Native.NotifiedChat) => void>();
let baseTitle: string | null = null;
let shownCount = -1;

function storedFlag(): boolean {
  try {
    return window.localStorage.getItem(NOTIFY_KEY) === "on";
  } catch {
    return false;
  }
}

export const browserNotifications: typeof Native.browserNotifications = {
  supported: () => typeof Notification === "function",
  enabled: () => typeof Notification === "function" && Notification.permission === "granted" && storedFlag(),
  // Only ever called from a click: browsers refuse (or remember a refusal of) a prompt nobody asked for.
  enable: async () => {
    if (typeof Notification !== "function") return false;
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") return false;
    try {
      window.localStorage.setItem(NOTIFY_KEY, "on");
    } catch {
      // Without storage the choice lasts until the tab closes.
    }
    return true;
  },
  disable: () => {
    try {
      window.localStorage.removeItem(NOTIFY_KEY);
    } catch {
      // Nothing kept, nothing to drop.
    }
  },
};

export const notifyChat: typeof Native.notifyChat = async (title, body, chat) => {
  if (!browserNotifications.enabled()) return;
  const shown = new Notification(title, { body, tag: `${chat.kind}:${chat.id}` });
  shown.onclick = () => {
    window.focus();
    for (const handler of openChatHandlers) handler(chat);
    shown.close();
  };
};

// ADR 0027 (F14-06): a click on a push opens the chat. An open tab gets it from the service worker; a new
// tab gets it once in `?chat=room:<id>`, which is removed from the address at once.
const CHAT_PARAM = /^(room|dm):([0-9a-f-]{36})$/i;
let openedChat: Native.NotifiedChat | null = (() => {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const found = CHAT_PARAM.exec(url.searchParams.get("chat") ?? "");
  if (!found) return null;
  url.searchParams.delete("chat");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  return { kind: found[1]?.toLowerCase() === "dm" ? "dm" : "room", id: (found[2] ?? "").toLowerCase() };
})();

export const takeOpenedChat: typeof Native.takeOpenedChat = () => {
  const chat = openedChat;
  openedChat = null;
  return chat;
};

if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { type?: unknown; chat?: { kind?: unknown; id?: unknown } } | null;
    if (data?.type !== "openmeet:open-chat" || typeof data.chat?.id !== "string") return;
    if (data.chat.kind !== "room" && data.chat.kind !== "dm") return;
    const chat: Native.NotifiedChat = { kind: data.chat.kind, id: data.chat.id };
    for (const handler of openChatHandlers) handler(chat);
  });
}

function pushKeyBytes(key: string): Uint8Array<ArrayBuffer> {
  const base64 = (key + "=".repeat((4 - (key.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function sameKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === key.length && bytes.every((byte, i) => byte === key[i]);
}

async function pushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  // Only the production web build registers a worker; without one there is nothing to push to.
  return (await navigator.serviceWorker.getRegistration("/")) ?? null;
}

export const webPush: typeof Native.webPush = {
  // Never prompts: it runs after the click that granted the permission, or at sign-in when it was granted
  // before. The server moves the subscription to whoever signs in on this browser.
  sync: async (api) => {
    try {
      if (!browserNotifications.enabled()) return false;
      const registration = await pushRegistration();
      const publicKey = registration ? await api.key() : null;
      if (!registration || !publicKey) return false;
      const key = pushKeyBytes(publicKey);
      let subscription = await registration.pushManager.getSubscription();
      // A new VAPID pair on the server makes the old subscription useless.
      if (subscription && !sameKey(subscription, key)) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const json = subscription.toJSON();
      const p256dh = json.keys?.p256dh;
      const auth = json.keys?.auth;
      if (!json.endpoint || !p256dh || !auth) return false;
      return await api.save({ endpoint: json.endpoint, keys: { p256dh, auth } });
    } catch {
      return false;
    }
  },
  // Before sign-out or when turned off: the server forgets this browser first, then the browser lets go.
  stop: async (api) => {
    try {
      const subscription = await (await pushRegistration())?.pushManager.getSubscription();
      if (!subscription) return;
      await api.drop(subscription.endpoint);
      await subscription.unsubscribe();
    } catch {
      // A browser that cannot unsubscribe is dropped by the server on the next 404/410.
    }
  },
};

export const listenOpenChat: typeof Native.listenOpenChat = async (handler) => {
  openChatHandlers.add(handler);
  return () => openChatHandlers.delete(handler);
};

function faviconLink(): HTMLLinkElement {
  const found = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (found) return found;
  const link = document.createElement("link");
  link.rel = "icon";
  document.head.appendChild(link);
  return link;
}

// The app icon with a red dot in the corner; the plain icon when nothing is unread.
function paintFavicon(dot: boolean): void {
  const link = faviconLink();
  if (!dot) {
    link.type = "image/svg+xml";
    link.href = BASE_ICON;
    return;
  }
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context || shownCount <= 0) return;
    context.drawImage(image, 0, 0, 64, 64);
    context.beginPath();
    context.arc(48, 48, 15, 0, Math.PI * 2);
    context.fillStyle = "#e5484d";
    context.fill();
    link.type = "image/png";
    link.href = canvas.toDataURL("image/png");
  };
  image.src = BASE_ICON;
}

export const setUnreadBadge: typeof Native.setUnreadBadge = async (count) => {
  baseTitle ??= document.title.replace(/^\(\d+\+?\) /, "");
  document.title = titleWithCount(baseTitle, count);
  if (count > 0 !== shownCount > 0) paintFavicon(count > 0);
  shownCount = count;
};
