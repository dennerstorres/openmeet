import { prepareInstanceRequest, type ApiResult, type InstanceApi, type SessionBroker } from "@openmeet/shared";

// ADR 0014: in the browser the session lives in HttpOnly cookies set by the instance. The page holds this
// marker where the .exe page holds the native one; it is never sent anywhere.
export const COOKIE_MARKER = "held-by-cookie";

const START_PATH = { login: "/api/v1/auth/login", bootstrap: "/api/v1/auth/bootstrap", google: "/api/v1/auth/google/poll" } as const;

async function readResult(response: Response): Promise<ApiResult> {
  const text = await response.text();
  if (text.length === 0) return { status: response.status, body: null };
  try {
    return { status: response.status, body: JSON.parse(text) as unknown };
  } catch {
    return { status: response.status, body: null };
  }
}

// ADR 0028: tests import this module without Vite, where the define is absent.
const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

/** A session answer for the model: the marker in place of any token the body could carry. */
function withMarker(result: ApiResult): ApiResult {
  if (result.status !== 200 && result.status !== 201) return result;
  if (typeof result.body !== "object" || result.body === null || Array.isArray(result.body)) return result;
  const body = Object.fromEntries(Object.entries(result.body).filter(([key]) => key !== "accessToken" && key !== "refreshToken"));
  return { status: result.status, body: { ...body, accessToken: COOKIE_MARKER } };
}

export interface WebSession {
  api: InstanceApi;
  broker: SessionBroker;
}

/**
 * Same-origin calls with the cookie and the web header. No Authorization header, no token in the page.
 * One refresh at a time: two parallel refreshes would replay the same cookie, which the API treats as reuse.
 */
export function createWebSession(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)): WebSession {
  let refreshing: Promise<ApiResult> | null = null;

  async function call(origin: string, method: "GET" | "POST", path: string, body: unknown): Promise<ApiResult> {
    const prepared = prepareInstanceRequest(origin, origin, method, path, body, null);
    const init: RequestInit = {
      method: prepared.method,
      headers: { ...prepared.headers, "x-openmeet-web": "1", "x-openmeet-version": APP_VERSION },
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
    };
    if (prepared.body !== undefined) init.body = prepared.body;
    return readResult(await fetchImpl(prepared.url, init));
  }

  function refresh(origin: string): Promise<ApiResult> {
    refreshing ??= call(origin, "POST", "/api/v1/auth/refresh", {}).finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  const api: InstanceApi = {
    async request(origin, method, path, body, accessToken) {
      const result = await call(origin, method, path, body);
      // The access cookie lives 15 min. One silent refresh, then the same call once more.
      if (result.status !== 401 || accessToken === null || path.startsWith("/api/v1/auth/")) return result;
      const renewed = await refresh(origin);
      if (renewed.status !== 200) return result;
      return call(origin, method, path, body);
    },
  };

  const broker: SessionBroker = {
    async start(origin, kind, body) {
      return withMarker(await call(origin, "POST", START_PATH[kind], body));
    },
    async refresh(origin) {
      return withMarker(await refresh(origin));
    },
    logout(origin) {
      return call(origin, "POST", "/api/v1/auth/logout", {});
    },
  };

  return { api, broker };
}
