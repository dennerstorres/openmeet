import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ApiResult, InstanceApi, SessionBroker } from "@openmeet/shared";
import { createRenewal } from "./renew";

export { isTauri };

export interface ShortcutView {
  id: string;
  accelerator: string;
  registered: boolean;
}

export interface ShellStatus {
  shortcutConsent: boolean;
  shortcuts: ShortcutView[];
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

export function shellStatus(): Promise<ShellStatus> {
  return invoke<ShellStatus>("shell_status");
}

export function setShortcutConsent(consent: boolean): Promise<ShellStatus> {
  return invoke<ShellStatus>("shell_set_consent", { consent });
}

export function shellTracks(live: boolean, microphone: boolean, camera: boolean, announce: "microphone" | "camera" | null): Promise<void> {
  return invoke("shell_tracks", { live, microphone, camera, announce });
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
