import { DisconnectReason } from "livekit-client";

export type ConnectionPhase = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected" | "fatal";

export type ConnectionEvent = "connect_started" | "connected" | "reconnecting" | "reconnected" | "disconnected" | "left" | "fatal" | "reset";

export interface DisconnectOutcome {
  event: "left" | "fatal";
  reason: string;
}

export function disconnectReasonName(reason: DisconnectReason | undefined): string {
  if (reason === undefined) {
    return "UNKNOWN_REASON";
  }
  const name = DisconnectReason[reason];
  return typeof name === "string" ? name : "UNKNOWN_REASON";
}

export function classifyDisconnect(reason: DisconnectReason | undefined, explicitLeave: boolean): DisconnectOutcome {
  if (explicitLeave || reason === DisconnectReason.CLIENT_INITIATED) {
    return { event: "left", reason: "CLIENT_INITIATED" };
  }
  return { event: "fatal", reason: disconnectReasonName(reason) };
}

export function nextPhase(current: ConnectionPhase, event: ConnectionEvent): ConnectionPhase {
  if (event === "reset") {
    return "idle";
  }
  if (current === "fatal" && event !== "connect_started") {
    return "fatal";
  }
  switch (event) {
    case "connect_started":
      return "connecting";
    case "connected":
    case "reconnected":
      return "connected";
    case "reconnecting":
      return current === "idle" ? "idle" : "reconnecting";
    case "left":
      return "disconnected";
    case "disconnected":
      return current === "connecting" ? "fatal" : "disconnected";
    case "fatal":
      return "fatal";
    default:
      return current;
  }
}
