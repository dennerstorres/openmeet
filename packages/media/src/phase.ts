export type ConnectionPhase = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected" | "fatal";

export type ConnectionEvent = "connect_started" | "connected" | "reconnecting" | "reconnected" | "disconnected" | "fatal" | "reset";

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
    case "disconnected":
      return current === "connecting" ? "fatal" : "disconnected";
    case "fatal":
      return "fatal";
    default:
      return current;
  }
}
