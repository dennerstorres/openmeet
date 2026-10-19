import { useEffect, useRef } from "react";
import {
  applyPlayback,
  cardInitial,
  effectivePlayback,
  shouldAttachPlayback,
  shouldShowLiveVideo,
  type CardLayout,
  type MeetingCard,
  type PlaybackLevel,
  type TrackTile,
} from "@openmeet/media";

export interface CardStageProps {
  cards: readonly MeetingCard[];
  tiles: readonly TrackTile[];
  layout: CardLayout;
  featuredId: string | null;
  others: readonly string[];
  pinnedId: string | null;
  speakers: readonly string[];
  deafened: boolean;
  fullscreen: boolean;
  levelFor: (cardId: string) => PlaybackLevel;
  onLevel: (cardId: string, patch: Partial<PlaybackLevel>) => void;
  onPin: (cardId: string | null) => void;
}

export function CardStage(props: CardStageProps) {
  const byId = new Map(props.cards.map((card) => [card.id, card]));
  const tileById = new Map(props.tiles.map((tile) => [tile.id, tile]));
  const featured = props.featuredId === null ? undefined : byId.get(props.featuredId);
  const others = props.others.flatMap((id) => {
    const card = byId.get(id);
    return card === undefined ? [] : [card];
  });
  const render = (card: MeetingCard, size: "center" | "strip" | "grid") => (
    <CardView
      key={card.id}
      card={card}
      size={size}
      video={card.videoId === null ? undefined : tileById.get(card.videoId)}
      pinned={props.pinnedId === card.id}
      speaking={card.kind === "person" && props.speakers.includes(card.identity)}
      playback={props.levelFor(card.id)}
      onLevel={(patch) => props.onLevel(card.id, patch)}
      onPin={() => props.onPin(props.pinnedId === card.id ? null : card.id)}
    />
  );
  return (
    <div className={`cards ${props.layout}${props.fullscreen ? " fullscreen" : ""}`}>
      {props.layout === "spotlight" ? (
        <>
          <div className="center">{featured ? render(featured, "center") : <p className="empty">Ninguém na sala ainda.</p>}</div>
          {!props.fullscreen && others.length > 0 ? <div className="strip">{others.map((card) => render(card, "strip"))}</div> : null}
        </>
      ) : (
        <div className="card-grid">{others.map((card) => render(card, "grid"))}</div>
      )}
      {props.cards.flatMap((card) =>
        card.audioIds.flatMap((id) => {
          const tile = tileById.get(id);
          return tile === undefined || !shouldAttachPlayback(tile)
            ? []
            : [<AudioSink key={id} tile={tile} playback={effectivePlayback(props.levelFor(card.id), props.deafened)} />];
        }),
      )}
    </div>
  );
}

function CardView(props: {
  card: MeetingCard;
  size: "center" | "strip" | "grid";
  video: TrackTile | undefined;
  pinned: boolean;
  speaking: boolean;
  playback: PlaybackLevel;
  onLevel: (patch: Partial<PlaybackLevel>) => void;
  onPin: () => void;
}) {
  const { card } = props;
  const live = props.video !== undefined && shouldShowLiveVideo(props.video);
  const hearable = card.kind === "person" && !card.local && card.audioIds.length > 0;
  const name = card.kind === "share" ? `Tela de ${card.label}` : card.local ? `${card.label} (você)` : card.label;
  return (
    <article className={`card ${props.size}${props.pinned ? " pinned" : ""}${props.speaking ? " speaking" : ""}${card.kind === "share" ? " share" : ""}`}>
      {live && props.video ? (
        <VideoSink tile={props.video} />
      ) : (
        <div className="avatar" aria-hidden="true">
          <span>{cardInitial(card.label)}</span>
        </div>
      )}
      <footer>
        <span className="name">{name}</span>
        {props.speaking ? <span className="sr">falando</span> : null}
        {hearable && !props.playback.heard ? <span className="badge">mudo aqui</span> : null}
        <button type="button" className="ghost" aria-pressed={props.pinned} onClick={props.onPin}>
          {props.pinned ? "Soltar" : "Fixar"}
        </button>
      </footer>
      {hearable && props.size !== "strip" ? (
        <div className="card-audio">
          <button type="button" className="ghost" onClick={() => props.onLevel({ heard: !props.playback.heard })}>
            {props.playback.heard ? "Silenciar neste PC" : "Voltar a ouvir"}
          </button>
          <label>
            <span className="sr">Volume neste PC</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(props.playback.volume * 100)}
              aria-label={`Volume de ${card.label} neste PC`}
              onChange={(event) => props.onLevel({ volume: Number(event.currentTarget.value) / 100 })}
            />
          </label>
        </div>
      ) : null}
    </article>
  );
}

function VideoSink({ tile }: { tile: TrackTile }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    tile.attach(element);
    return () => {
      tile.detach(element);
    };
  }, [tile]);
  return <video ref={ref} autoPlay playsInline muted />;
}

function AudioSink({ tile, playback }: { tile: TrackTile; playback: PlaybackLevel }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    tile.attach(element);
    return () => {
      tile.detach(element);
    };
  }, [tile]);
  useEffect(() => {
    const element = ref.current;
    if (element) applyPlayback(element, playback);
  }, [tile, playback]);
  return <audio ref={ref} autoPlay hidden />;
}
