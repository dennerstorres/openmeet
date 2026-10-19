import { TrackSource, type VideoGrant } from "livekit-server-sdk";

/**
 * S-09: microphone, camera, screen image and, by ADR 0008, the PC audio of the screen share.
 * Nothing else: no data channel, no room admin. The list never comes from the request body.
 */
export const PUBLISH_SOURCES: readonly TrackSource[] = [TrackSource.MICROPHONE, TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO];

/** The one grant used by the room join and the POC join. */
export function roomGrant(room: string): VideoGrant {
  return { roomJoin: true, room, canPublish: true, canPublishSources: [...PUBLISH_SOURCES], canSubscribe: true, canPublishData: false };
}
