// ADR 0024: the live chat stream. The feed keeps the last event id, renews the session once on a 401 and
// reconnects with backoff; a `reset` from the API means the gap is gone and every open chat must reload.
// The web reads the stream with fetch (EventSource can send neither the web header nor show a 401);
// the .exe gets the same events from the native process, which holds the token.

export interface ChatRawEvent {
  id: string | null;
  name: string;
  data: string;
}

export type FeedState = "connecting" | "live" | "waiting" | "signed-out";

/** Opens one connection. `closed` fires once, with the HTTP status or 0 for a network failure. */
export interface ChatTransport {
  open(lastEventId: string | undefined, event: (event: ChatRawEvent) => void, closed: (status: number) => void): () => void;
}

export interface ChatFeedOptions {
  /** True when the session was renewed and the stream may be opened again. */
  renew: () => Promise<boolean>;
  event: (name: string, data: unknown) => void;
  reset: () => void;
  state?: (state: FeedState) => void;
  delay?: (attempt: number) => number;
  schedule?: (run: () => void, ms: number) => () => void;
}

export interface ChatFeed {
  close(): void;
}

const LINE_MAX = 1024 * 1024;

export function backoff(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
}

/** The same rules as the native parser: comments and retry skipped, data lines joined, CRLF accepted. */
export function createSseParser(): (chunk: string) => ChatRawEvent[] {
  let pending = "";
  let id: string | null = null;
  let name: string | null = null;
  let data: string[] = [];
  return (chunk) => {
    pending += chunk;
    const events: ChatRawEvent[] = [];
    let end = pending.indexOf("\n");
    while (end >= 0) {
      const line = pending.slice(0, end).replace(/\r$/, "");
      pending = pending.slice(end + 1);
      if (line === "") {
        if (name !== null) events.push({ id, name, data: data.join("\n") });
        id = null;
        name = null;
        data = [];
      } else if (!line.startsWith(":")) {
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const raw = colon < 0 ? "" : line.slice(colon + 1);
        const value = raw.startsWith(" ") ? raw.slice(1) : raw;
        if (field === "id") id = value;
        else if (field === "event") name = value;
        else if (field === "data") data.push(value);
      }
      end = pending.indexOf("\n");
    }
    if (pending.length > LINE_MAX) throw new Error("invalid_stream");
    return events;
  };
}

export function createChatFeed(transport: ChatTransport, options: ChatFeedOptions): ChatFeed {
  const delay = options.delay ?? backoff;
  const schedule =
    options.schedule ??
    ((run, ms) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    });
  let lastEventId: string | undefined;
  let attempt = 0;
  let renewed = false;
  let stopped = false;
  let stop: (() => void) | undefined;
  let pending: (() => void) | undefined;

  function state(next: FeedState): void {
    options.state?.(next);
  }

  function connect(): void {
    if (stopped) return;
    state("connecting");
    let done = false;
    stop = transport.open(
      lastEventId,
      (event) => {
        if (stopped || done) return;
        if (event.id !== null) lastEventId = event.id;
        if (event.name === "ready" || event.name === "reset") {
          attempt = 0;
          renewed = false;
          state("live");
          if (event.name === "reset") options.reset();
          return;
        }
        let data: unknown;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        options.event(event.name, data);
      },
      (status) => {
        if (stopped || done) return;
        done = true;
        stop = undefined;
        void closed(status);
      },
    );
  }

  async function closed(status: number): Promise<void> {
    if (status === 401) {
      // One renewal per failure; a second 401 right after means the session is over.
      if (!renewed && (await options.renew().catch(() => false))) {
        renewed = true;
        connect();
        return;
      }
      stopped = true;
      state("signed-out");
      return;
    }
    state("waiting");
    pending = schedule(
      () => {
        pending = undefined;
        connect();
      },
      delay(attempt + (status === 429 ? 3 : 0)),
    );
    attempt += 1;
  }

  connect();
  return {
    close() {
      stopped = true;
      pending?.();
      stop?.();
    },
  };
}

/** The web stream: same origin, cookie and web header, read with fetch so a 401 is visible. */
export function createWebTransport(origin: string, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)): ChatTransport {
  return {
    open(lastEventId, event, closed) {
      const controller = new AbortController();
      let aborted = false;
      const headers: Record<string, string> = { accept: "text/event-stream", "x-openmeet-web": "1" };
      if (lastEventId !== undefined) headers["last-event-id"] = lastEventId;
      void (async () => {
        try {
          const response = await fetchImpl(`${origin}/api/v1/events`, {
            headers,
            credentials: "same-origin",
            redirect: "error",
            cache: "no-store",
            signal: controller.signal,
          });
          const type = response.headers.get("content-type") ?? "";
          if (response.status !== 200 || !type.startsWith("text/event-stream") || !response.body) {
            await response.body?.cancel().catch(() => undefined);
            closed(response.status === 200 ? 0 : response.status);
            return;
          }
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          const parse = createSseParser();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const item of parse(decoder.decode(value, { stream: true }))) event(item);
          }
          closed(0);
        } catch {
          if (!aborted) closed(0);
        }
      })();
      return () => {
        aborted = true;
        controller.abort();
      };
    },
  };
}

export type ChatListener = { event: (name: string, data: unknown) => void; reset: () => void };

/** One feed for the session, many open views: each text room listens while it is on screen. */
export function createChatHub(): { subscribe(listener: ChatListener): () => void; event(name: string, data: unknown): void; reset(): void } {
  const listeners = new Set<ChatListener>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    event(name, data) {
      for (const listener of listeners) listener.event(name, data);
    },
    reset() {
      for (const listener of listeners) listener.reset();
    },
  };
}
