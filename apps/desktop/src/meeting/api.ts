import { LiveKitPocSession } from "@openmeet/media";
import { prepareInstanceRequest, type InstanceApi, type MeetingMedia } from "@openmeet/shared";

export function createFetchApi(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)): InstanceApi {
  return {
    async request(origin, method, path, body, accessToken) {
      const prepared = prepareInstanceRequest(origin, origin, method, path, body, accessToken);
      const init: RequestInit = {
        method: prepared.method,
        headers: prepared.headers,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      };
      if (prepared.body !== undefined) init.body = prepared.body;
      const response = await fetchImpl(prepared.url, init);
      const text = await response.text();
      if (text.length === 0) return { status: response.status, body: null };
      try {
        return { status: response.status, body: JSON.parse(text) as unknown };
      } catch {
        return { status: response.status, body: null };
      }
    },
  };
}

export function createLiveKitMedia(session: () => LiveKitPocSession): MeetingMedia {
  let tail: Promise<void> = Promise.resolve();
  const enqueue = (work: () => Promise<void>): Promise<void> => {
    const next = tail.then(work, work);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  return {
    connect: (url, token) => enqueue(() => session().connect(url, token)),
    disconnect: () =>
      enqueue(async () => {
        try {
          await session().disconnect();
        } catch {
          // Leaving before the first connection is not a meeting error.
        }
      }),
  };
}
