import { useSyncExternalStore } from "react";

// ADR 0027: registers the service worker and holds a new build in `waiting` until the person agrees and is
// not in a call. Only the production web build registers; Vite dev and the .exe never do.

type Listener = () => void;

let waiting: ServiceWorker | null = null;
let inCall = false;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** MeetingApp reports whether a call is open, so the update notice waits for it to end. */
export function setInCall(value: boolean) {
  if (inCall === value) return;
  inCall = value;
  emit();
}

/** The new build ready to apply, or null while there is none or a call is open. */
export function usePendingUpdate(): ServiceWorker | null {
  return useSyncExternalStore(subscribe, () => (inCall ? null : waiting));
}

function offer(worker: ServiceWorker | null) {
  // Without a controller this is the first install, not an update.
  if (worker === null || navigator.serviceWorker.controller === null) return;
  waiting = worker;
  emit();
}

/** Activates the waiting build; the page reloads once the new worker controls it. */
export function applyUpdate(worker: ServiceWorker) {
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  worker.postMessage("openmeet:activate");
}

const RECHECK_MS = 30 * 60 * 1000;

export async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  offer(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed") offer(worker);
    });
  });
  const recheck = () => void registration.update().catch(() => undefined);
  window.setInterval(recheck, RECHECK_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") recheck();
  });
}
