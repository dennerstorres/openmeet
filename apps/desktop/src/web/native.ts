import { prepareInstanceRequest } from "@openmeet/shared";
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

// ADR 0024: the web reads the chat stream with fetch (meeting/chat-events.ts); there is no native one.
export const createDesktopChatTransport: typeof Native.createDesktopChatTransport = () => ({
  open: (_lastEventId, _event, closed) => {
    queueMicrotask(() => closed(0));
    return () => undefined;
  },
});

export const renewDesktopSession: typeof Native.renewDesktopSession = async () => false;
