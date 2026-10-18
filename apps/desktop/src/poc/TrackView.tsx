import { useEffect, useRef, type RefObject } from "react";
import { shouldAttachPlayback, type TrackTile } from "@openmeet/media";

export function TrackView({ tile }: { tile: TrackTile }) {
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

  const label = `${tile.local ? "local" : tile.identity} ${tile.source}`;
  if (!shouldAttachPlayback(tile)) {
    return (
      <figure>
        <figcaption>{label}</figcaption>
        <p>sem retorno neste PC</p>
      </figure>
    );
  }
  if (tile.media === "audio") {
    return (
      <figure>
        <figcaption>{label}</figcaption>
        <audio ref={ref as RefObject<HTMLAudioElement>} autoPlay controls />
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
