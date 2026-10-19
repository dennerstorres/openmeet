import { useEffect, useRef, type RefObject } from "react";
import { applyPlayback, shouldAttachPlayback, shouldShowLiveVideo, type PlaybackLevel, type TrackTile } from "@openmeet/media";

export function TrackView({ tile, playback }: { tile: TrackTile; playback?: PlaybackLevel }) {
  const ref = useRef<HTMLVideoElement | HTMLAudioElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    tile.attach(element);
    return () => {
      tile.detach(element);
    };
  }, [tile]);

  useEffect(() => {
    const element = ref.current;
    if (!element || !playback) {
      return;
    }
    applyPlayback(element, playback);
  }, [tile, playback]);

  const label = `${tile.local ? "local" : tile.identity} ${tile.source}`;
  if (!shouldAttachPlayback(tile)) {
    return (
      <figure>
        <figcaption>{label}</figcaption>
        <p>sem retorno neste PC</p>
      </figure>
    );
  }
  if (tile.media === "video" && !shouldShowLiveVideo(tile)) {
    return (
      <figure>
        <figcaption>{label}</figcaption>
        <p>vídeo pausado</p>
      </figure>
    );
  }
  if (tile.media === "audio") {
    return (
      <figure>
        <figcaption>{label}</figcaption>
        {tile.muted ? <p>áudio remoto pausado</p> : null}
        <audio ref={ref as RefObject<HTMLAudioElement>} autoPlay controls={playback === undefined} />
      </figure>
    );
  }
  return (
    <figure>
      <figcaption>{label}</figcaption>
      <video ref={ref as RefObject<HTMLVideoElement>} autoPlay playsInline muted={tile.local} />
    </figure>
  );
}
