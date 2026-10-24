/**
 * Windows splits a Bluetooth headset into a stereo output and a Hands-Free one.
 * The Hands-Free output only plays while the headset microphone is open, so a
 * call with another microphone goes silent on it. These rules keep the sound on
 * the stereo output in that case.
 */
export interface AudioDevice {
  deviceId: string;
  label: string;
  kind: "audioinput" | "audiooutput" | "videoinput";
  groupId?: string;
}

const HANDS_FREE = /hands[\s-]?free/i;
const ALIAS_PREFIX = /^(padrão|default|comunicações|communications)\s*-\s*/i;
const PSEUDO_IDS = new Set(["default", "communications"]);

export const HANDS_FREE_HINT = "só com o microfone do fone";

export function isHandsFree(label: string): boolean {
  return HANDS_FREE.test(label);
}

/** Headset name shared by its endpoints: "Fone de ouvido (WH-1000XM4 Hands-Free)" → "wh-1000xm4". */
export function headsetKey(label: string): string {
  const plain = label.replace(ALIAS_PREFIX, "");
  const inner = /\(([^)]+)\)/.exec(plain)?.[1] ?? plain;
  return inner
    .replace(/hands[\s-]?free/gi, "")
    .replace(/\bag audio\b/gi, "")
    .replace(/\bstereo\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function sameHeadset(a: AudioDevice, b: AudioDevice): boolean {
  if (a.groupId && b.groupId && a.groupId === b.groupId) return true;
  const key = headsetKey(a.label);
  return key.length > 0 && key === headsetKey(b.label);
}

/** Output that should play the call, given what the user picked and the open microphone. */
export function playbackOutput(devices: AudioDevice[], requestedId: string, inputId: string | undefined): string {
  const requested = devices.find((device) => device.kind === "audiooutput" && device.deviceId === requestedId);
  if (!requested || !isHandsFree(requested.label)) return requestedId;
  const input = devices.find((device) => device.kind === "audioinput" && device.deviceId === inputId);
  if (input && sameHeadset(input, requested)) return requestedId;
  const stereo = devices.find(
    (device) => device.kind === "audiooutput" && !PSEUDO_IDS.has(device.deviceId) && !isHandsFree(device.label) && sameHeadset(device, requested),
  );
  return stereo?.deviceId ?? requestedId;
}
