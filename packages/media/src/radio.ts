import { AudioPresets, Track, type AudioCaptureOptions, type TrackPublishOptions } from "livekit-client";

/** ADR 0022: the radio rides the screen-audio source the grant already allows, told apart by this track name. */
export const RADIO_TRACK_NAME = "openmeet-radio";

/** Music, not voice: no echo cancellation, noise suppression or automatic gain, stereo when the input has it. */
export function radioCapture(deviceId: string): AudioCaptureOptions {
  return {
    deviceId: { exact: deviceId },
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 2,
  };
}

export function radioPublish(): TrackPublishOptions {
  return {
    name: RADIO_TRACK_NAME,
    source: Track.Source.ScreenShareAudio,
    audioPreset: AudioPresets.musicHighQualityStereo,
    forceStereo: true,
    dtx: false,
    red: false,
  };
}

export function isRadio(publication: { source: Track.Source; trackName: string } | undefined): boolean {
  return publication !== undefined && publication.source === Track.Source.ScreenShareAudio && publication.trackName === RADIO_TRACK_NAME;
}
