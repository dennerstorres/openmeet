import type { ApiResult } from "@openmeet/shared";

/**
 * The access token lives 15 min in the native process. A call answered 401 renews it once and runs again.
 * One renewal at a time: two parallel refreshes would replay the same refresh token, which the API treats
 * as reuse and answers by revoking the whole family (F10-03).
 */
export interface Renewal {
  renew(origin: string): Promise<ApiResult | null>;
  call(origin: string, run: () => Promise<ApiResult>): Promise<ApiResult>;
}

const UNAUTHORIZED: ApiResult = { status: 401, body: { error: "unauthorized" } };

// The native side rejects with "unauthorized" when it holds no token, e.g. right after another call's 401.
async function attempt(run: () => Promise<ApiResult>): Promise<ApiResult> {
  try {
    return await run();
  } catch (error) {
    if (error === "unauthorized") return UNAUTHORIZED;
    throw error;
  }
}

export function createRenewal(refresh: (origin: string) => Promise<ApiResult | null>): Renewal {
  let flight: Promise<ApiResult | null> | null = null;

  function renew(origin: string): Promise<ApiResult | null> {
    flight ??= refresh(origin).finally(() => {
      flight = null;
    });
    return flight;
  }

  return {
    renew,
    async call(origin, run) {
      const first = await attempt(run);
      if (first.status !== 401) return first;
      const renewed = await renew(origin).catch(() => null);
      if (renewed?.status !== 200) return first;
      return attempt(run);
    },
  };
}
