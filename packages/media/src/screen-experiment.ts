/**
 * F17-04/F17-05: one controlled change to the screen-share pipeline at a time, for comparison against production.
 * Nothing here changes the defaults: with no experiment the publish options and room options are exactly the ADR 0029
 * ones. An experiment is read from a local setting on this device, so it never leaves the machine except inside the
 * consented diagnostic, where it labels the samples it produced.
 */
export type ScreenExperiment =
  | { kind: "codec"; codec: "vp8" | "vp9" | "h264" }
  | { kind: "adaptiveStream"; enabled: boolean }
  | { kind: "dynacast"; enabled: boolean }
  | { kind: "simulcast"; enabled: boolean }
  | { kind: "resolution"; preset: "1080p15" | "1440p15" }
  | { kind: "pixelDensity"; value: "screen" }
  | { kind: "focusQuality"; value: "high" }
  | { kind: "contentHint"; value: "detail" | "text" };

export const SCREEN_EXPERIMENT_KEY = "openmeet.screenExperiment";

const BOOLEAN_KINDS = new Set(["adaptiveStream", "dynacast", "simulcast"]);

/**
 * Parses `kind=value`, e.g. `codec=h264` or `dynacast=off`. Exactly one variable, otherwise `null`: a comparison
 * that moves two knobs at once cannot attribute the result.
 */
export function parseScreenExperiment(raw: string | null | undefined): ScreenExperiment | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.includes(",") || text.includes(";")) return null;
  const match = /^([A-Za-z]+)=([A-Za-z0-9]+)$/.exec(text);
  if (!match) return null;
  const kind = match[1] as string;
  const value = (match[2] as string).toLowerCase();
  if (kind === "codec" && (value === "vp8" || value === "vp9" || value === "h264")) return { kind, codec: value };
  if (BOOLEAN_KINDS.has(kind) && (value === "on" || value === "off")) {
    return { kind: kind as "adaptiveStream" | "dynacast" | "simulcast", enabled: value === "on" };
  }
  if (kind === "resolution" && (value === "1080p15" || value === "1440p15")) return { kind, preset: value };
  if (kind === "pixelDensity" && value === "screen") return { kind, value };
  if (kind === "focusQuality" && value === "high") return { kind, value };
  if (kind === "contentHint" && (value === "detail" || value === "text")) return { kind, value };
  return null;
}

export function describeScreenExperiment(experiment: ScreenExperiment | null): string {
  if (!experiment) return "production";
  switch (experiment.kind) {
    case "codec":
      return `codec=${experiment.codec}`;
    case "adaptiveStream":
    case "dynacast":
    case "simulcast":
      return `${experiment.kind}=${experiment.enabled ? "on" : "off"}`;
    case "resolution":
      return `resolution=${experiment.preset}`;
    case "pixelDensity":
    case "focusQuality":
    case "contentHint":
      return `${experiment.kind}=${experiment.value}`;
  }
}

const OVERRIDDEN = " (overridden)";

/**
 * F17-07 third pass: the exported label is rebuilt from the parsed experiment, never copied. Text that is not
 * `production` or a valid experiment (optionally marked as overridden by the SDK) exports as `invalid`.
 */
export function screenExperimentLabel(value: unknown): string {
  if (typeof value !== "string") return "production";
  const overridden = value.endsWith(OVERRIDDEN);
  const base = overridden ? value.slice(0, -OVERRIDDEN.length) : value;
  if (base === "production") return overridden ? "invalid" : "production";
  const parsed = parseScreenExperiment(base);
  return parsed ? describeScreenExperiment(parsed) + (overridden ? OVERRIDDEN : "") : "invalid";
}

/** Reads the experiment from local storage; any failure (no storage, private mode) means production. */
export function readScreenExperiment(storage?: Pick<Storage, "getItem"> | null): ScreenExperiment | null {
  try {
    const source = storage ?? (typeof localStorage === "undefined" ? null : localStorage);
    return parseScreenExperiment(source?.getItem(SCREEN_EXPERIMENT_KEY));
  } catch {
    return null;
  }
}
