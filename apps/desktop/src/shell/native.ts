import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ApiResult, SessionBroker } from "@openmeet/shared";

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

// S-05: login, refresh and logout run in the native process. The refresh never crosses into the page.
export function createDesktopBroker(): SessionBroker {
  return {
    start(origin, kind, body) {
      const command = kind === "login" ? "session_login" : kind === "bootstrap" ? "session_bootstrap" : "session_google";
      return invoke<ApiResult>(command, { origin, ...body });
    },
    refresh(origin) {
      return invoke<ApiResult | null>("session_refresh", { origin });
    },
    logout(origin) {
      return invoke<ApiResult>("session_logout", { origin });
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
