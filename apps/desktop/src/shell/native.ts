import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ApiResult, InstanceApi, SessionBroker } from "@openmeet/shared";
import type { ChatRawEvent, ChatTransport } from "../meeting/chat-events";
import { createRenewal } from "./renew";
import type { UpdateView } from "./update";

export { isTauri };

export interface ShortcutView {
  id: string;
  accelerator: string;
  registered: boolean;
}

export interface ShellStatus {
  shortcutConsent: boolean;
  shortcuts: ShortcutView[];
  autostart: boolean;
}

// The broker's refresh and the 401 renewal of instance calls share one flight.
const renewal = createRenewal((origin) => invoke<ApiResult | null>("session_refresh", { origin }));

// S-05: login, refresh and logout run in the native process. The refresh never crosses into the page.
export function createDesktopBroker(): SessionBroker {
  return {
    start(origin, kind, body) {
      const command = kind === "login" ? "session_login" : kind === "bootstrap" ? "session_bootstrap" : "session_google";
      return invoke<ApiResult>(command, { origin, ...body });
    },
    refresh(origin) {
      return renewal.renew(origin);
    },
    logout(origin) {
      return invoke<ApiResult>("session_logout", { origin });
    },
  };
}

/**
 * S-06: with a session, every instance call goes through the native process, which holds the access
 * token and allows only the room and server routes. The page holds a marker, not the token. Calls without
 * a session (instance card, Google start) stay on fetch.
 */
export function createDesktopApi(open: InstanceApi): InstanceApi {
  return {
    request(origin, method, path, body, accessToken) {
      if (accessToken === null) return open.request(origin, method, path, body, null);
      const args = { origin, method, path, body: method === "GET" ? null : (body ?? {}) };
      return renewal.call(origin, () => invoke<ApiResult>("instance_call", args));
    },
  };
}

/** True when the native session was renewed; shared with the 401 renewal of instance calls. */
export async function renewDesktopSession(origin: string): Promise<boolean> {
  return (await renewal.renew(origin))?.status === 200;
}

/**
 * ADR 0024: the chat stream through the native process, which holds the token and opens the connection.
 * Only one stream lives there; opening replaces it, and a stale `chat-closed` is ignored once this one ended.
 */
export function createDesktopChatTransport(origin: string): ChatTransport {
  return {
    open(lastEventId, event, closed) {
      let active = true;
      const listeners: UnlistenFn[] = [];
      const release = () => {
        for (const unlisten of listeners.splice(0)) unlisten();
      };
      const finish = (status: number) => {
        if (!active) return;
        active = false;
        release();
        closed(status);
      };
      void (async () => {
        try {
          listeners.push(
            await listen<ChatRawEvent>("chat-event", (message) => {
              if (active) event(message.payload);
            }),
          );
          listeners.push(await listen<{ status: number }>("chat-closed", (message) => finish(message.payload.status)));
          if (!active) {
            release();
            return;
          }
          await invoke("instance_events_open", { origin, lastEventId: lastEventId ?? null });
        } catch (error) {
          finish(error === "unauthorized" ? 401 : 0);
        }
      })();
      return () => {
        if (!active) return;
        active = false;
        release();
        void invoke("instance_events_close").catch(() => undefined);
      };
    },
  };
}

/** ADR 0019: one icon or avatar through the native session. The page checks the bytes again. */
export async function fetchImage(origin: string, id: string): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>("instance_image", { origin, id }));
}

/** ADR 0021: one library sound through the native session. The page checks the WAV again. */
export async function fetchSound(origin: string, id: string): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>("instance_sound", { origin, id }));
}

export function shellStatus(): Promise<ShellStatus> {
  return invoke<ShellStatus>("shell_status");
}

export function setShortcutConsent(consent: boolean): Promise<ShellStatus> {
  return invoke<ShellStatus>("shell_set_consent", { consent });
}

export function setAutostart(enabled: boolean): Promise<ShellStatus> {
  return invoke<ShellStatus>("shell_set_autostart", { enabled });
}

export function shellTracks(live: boolean, microphone: boolean, camera: boolean, announce: "microphone" | "camera" | null): Promise<void> {
  return invoke("shell_tracks", { live, microphone, camera, announce });
}

/** ADR 0018: the check and the install run in Rust; the install refuses a live meeting. */
export function checkUpdate(): Promise<UpdateView | null> {
  return invoke<UpdateView | null>("update_check");
}

export function installUpdate(): Promise<void> {
  return invoke("update_install");
}

export function showWindow(): Promise<void> {
  return invoke("shell_show");
}

export function listenShell(handler: (action: string) => void): Promise<UnlistenFn> {
  return listen<string>("shell-action", (event) => {
    handler(event.payload);
  });
}

/** An invite link the app was opened with, taken once. The Rust side already kept only openmeet://convite links. */
export function takeInvite(): Promise<string | null> {
  return invoke<string | null>("invite_take");
}

/** The native side only signals; the link itself is taken once through invite_take. */
export function listenInvite(handler: (link: string) => void): Promise<UnlistenFn> {
  return listen("invite-link", () => {
    void takeInvite()
      .then((link) => {
        if (link !== null) handler(link);
      })
      .catch(() => undefined);
  });
}

/** ADR 0010: Google opens in the system browser, never in this window. The native side checks the address again. */
export async function openGoogleLogin(url: string): Promise<void> {
  if (isTauri()) {
    await invoke("open_google_login", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** ADR 0024: a chat link the person confirmed, opened by the native side in the system browser. */
export function openChatLink(url: string): Promise<void> {
  return invoke("open_chat_link", { url });
}
