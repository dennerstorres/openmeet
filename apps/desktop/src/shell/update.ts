/** ADR 0018: checked at start and every six hours; installed only when the person confirms. */
export const UPDATE_EVERY_MS = 6 * 60 * 60 * 1000;

export interface UpdateView {
  version: string;
  notes: string | null;
}

export function updateFailure(error: unknown): string {
  if (error === "update_in_call") return "Saia da chamada para instalar a atualização.";
  if (error === "update_missing") return "A atualização não está mais disponível. Tente de novo mais tarde.";
  return "Não foi possível instalar a atualização agora.";
}

/** Runs `check` now and on every interval; a failed check stays silent and waits for the next one. */
export function watchUpdates(check: () => Promise<UpdateView | null>, found: (update: UpdateView) => void, every = UPDATE_EVERY_MS): () => void {
  let stopped = false;
  const run = () => {
    check().then(
      (update) => {
        if (update && !stopped) found(update);
      },
      () => undefined,
    );
  };
  run();
  const timer = setInterval(run, every);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
