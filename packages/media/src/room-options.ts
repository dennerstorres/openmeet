import type { RoomOptions } from "livekit-client";

/**
 * ADR 0029 (F15-03): each viewer receives only the layer its card needs (adaptiveStream), and a sender stops
 * encoding layers nobody watches (dynacast). Cards attach through `track.attach`, so the SDK sees their size.
 */
export function roomOptions(): RoomOptions {
  return { adaptiveStream: true, dynacast: true };
}
