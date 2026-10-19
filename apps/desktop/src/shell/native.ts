import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { SessionVault } from "@openmeet/shared";

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

export function createDesktopVault(): SessionVault {
  return {
    load(origin) {
      return invoke<string | null>("session_load", { origin });
    },
    async save(origin, refreshToken) {
      await invoke("session_save", { origin, refreshToken });
    },
    async clear(origin) {
      await invoke("session_clear", { origin });
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
