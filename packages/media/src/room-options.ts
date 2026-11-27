import type { RoomOptions } from "livekit-client";
import type { ScreenExperiment } from "./screen-experiment.js";

/**
 * ADR 0029 (F15-03): each viewer receives only the layer its card needs (adaptiveStream), and a sender stops
 * encoding layers nobody watches (dynacast). Cards attach through `track.attach`, so the SDK sees their size.
 * F17-05: one experiment may turn either off, or count the real screen pixels (`devicePixelRatio`) when the SDK
 * sizes a layer; the SDK default is 1 below a ratio of 2, so a 150 % Windows scale asks for a smaller layer.
 */
export function roomOptions(experiment: ScreenExperiment | null = null): RoomOptions {
  let adaptiveStream: RoomOptions["adaptiveStream"] = true;
  let dynacast = true;
  if (experiment?.kind === "adaptiveStream" || experiment?.kind === "focusQuality") adaptiveStream = experiment.kind === "adaptiveStream" && experiment.enabled;
  if (experiment?.kind === "dynacast") dynacast = experiment.enabled;
  if (experiment?.kind === "pixelDensity") adaptiveStream = { pixelDensity: "screen" };
  return { adaptiveStream, dynacast };
}
