/** ADR 0018 and 0025: checked at start, every hour and when the window comes back; the check answers once the package is downloaded. */
export const UPDATE_EVERY_MS = 60 * 60 * 1000;
/** A window coming back checks again only after this gap since the last check. */
export const UPDATE_WAKE_GAP_MS = 15 * 60 * 1000;
/** A check refused in a call, or failed, tries again this soon. */
export const UPDATE_RETRY_MS = 10 * 60 * 1000;

export interface UpdateView {
  version: string;
  notes: string | null;
}

export function updateFailure(error: unknown): string {
  if (error === "update_in_call") return "Saia da chamada para reiniciar e atualizar.";
  if (error === "update_missing") return "A atualização não está mais disponível. Tente de novo mais tarde.";
  return "Não foi possível instalar a atualização agora.";
}

/** Runs `check` now, on every interval and on `wake` past `gap`; a failed check stays silent and tries again after `retry`. */
export function watchUpdates(
  check: () => Promise<UpdateView | null>,
  found: (update: UpdateView) => void,
  every = UPDATE_EVERY_MS,
  retry = UPDATE_RETRY_MS,
  wake: (signal: () => void) => () => void = () => () => {},
  gap = UPDATE_WAKE_GAP_MS,
): () => void {
  let stopped = false;
  let again: ReturnType<typeof setTimeout> | undefined;
  let last = 0;
  const run = () => {
    clearTimeout(again);
    last = Date.now();
    check().then(
      (update) => {
        if (update && !stopped) found(update);
      },
      () => {
        if (!stopped) again = setTimeout(run, retry);
      },
    );
  };
  run();
  const timer = setInterval(run, every);
  const unwake = wake(() => {
    if (!stopped && Date.now() - last >= gap) run();
  });
  return () => {
    stopped = true;
    unwake();
    clearInterval(timer);
    clearTimeout(again);
  };
}

/** The window shown again from the tray, or focused. */
export function windowWake(signal: () => void): () => void {
  const onVisible = () => {
    if (document.visibilityState === "visible") signal();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", signal);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", signal);
  };
}
