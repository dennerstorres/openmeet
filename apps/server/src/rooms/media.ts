import { RoomServiceClient, ServerError } from "livekit-server-sdk";
import type { AppEnv } from "../poc-join.js";

/**
 * `revokeAt` is chosen by the caller from the `nbf` of the tokens it signed (S-04).
 * LiveKit refuses a token whose `nbf` is earlier than it; equal still passes, so the caller adds one.
 */
export interface RoomMedia {
  disconnect(room: string, identity: string, revokeAt: bigint): Promise<void>;
  closeRoom(room: string, revokeAt: bigint): Promise<void>;
  /** Identities in the SFU room right now. A room that does not exist yet is empty. */
  occupants?(room: string): Promise<string[]>;
}

interface LiveKitRooms {
  listParticipants(room: string): Promise<{ identity: string }[]>;
  removeParticipant(room: string, identity: string, options?: { revokeTokenTs?: bigint }): Promise<void>;
  deleteRoom(room: string): Promise<void>;
}

function isAbsent(error: unknown): boolean {
  return error instanceof ServerError && error.status === 404;
}

export function roomMedia(client: LiveKitRooms): RoomMedia {
  return {
    async disconnect(room, identity, revokeAt) {
      try {
        await client.removeParticipant(room, identity, { revokeTokenTs: revokeAt });
      } catch (error) {
        if (!isAbsent(error)) throw error;
      }
    },
    async occupants(room) {
      try {
        const people = await client.listParticipants(room);
        return people.map((person) => person.identity).filter((identity) => identity.length > 0);
      } catch (error) {
        if (isAbsent(error)) return [];
        throw error;
      }
    },
    async closeRoom(room, revokeAt) {
      let people: { identity: string }[] = [];
      try {
        people = await client.listParticipants(room);
      } catch (error) {
        if (!isAbsent(error)) throw error;
      }
      for (const person of people) {
        if (person.identity.length === 0) continue;
        try {
          await client.removeParticipant(room, person.identity, { revokeTokenTs: revokeAt });
        } catch (error) {
          if (!isAbsent(error)) throw error;
        }
      }
      try {
        await client.deleteRoom(room);
      } catch (error) {
        if (!isAbsent(error)) throw error;
      }
    },
  };
}

export function liveKitHttpHost(signalUrl: string): string {
  const url = new URL(signalUrl);
  if (url.protocol === "wss:") url.protocol = "https:";
  else if (url.protocol === "ws:") url.protocol = "http:";
  else if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("unsupported signal protocol");
  return url.origin;
}

export function liveKitRoomMedia(env: AppEnv): RoomMedia | undefined {
  const apiKey = env.LIVEKIT_API_KEY;
  const apiSecret = env.LIVEKIT_API_SECRET;
  const signalUrl = env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !signalUrl) return undefined;
  let host: string;
  try {
    host = liveKitHttpHost(signalUrl);
  } catch {
    return undefined;
  }
  const client = new RoomServiceClient(host, apiKey, apiSecret);
  return roomMedia({
    listParticipants: async (room) => {
      const people = await client.listParticipants(room);
      return people.map((person) => ({ identity: person.identity }));
    },
    removeParticipant: (room, identity, options) => client.removeParticipant(room, identity, options),
    deleteRoom: (room) => client.deleteRoom(room),
  });
}
