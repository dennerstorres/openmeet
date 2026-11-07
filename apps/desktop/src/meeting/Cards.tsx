import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@fluentui/react-components";
import { Face } from "./images";
import { useContextMenu, type MenuItem } from "./ContextMenu";
import {
  applyPlayback,
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
  origin: string | null;
  /** ADR 0019: the avatar of a person in the call, from the member list. */
  avatarFor: (identity: string) => string | null;
  /** The account name behind a nickname, shown on hover. */
  accountFor: (identity: string) => string | null;
  tiles: readonly TrackTile[];
  layout: CardLayout;
  featuredId: string | null;
  others: readonly string[];
  pinnedId: string | null;
  speakers: readonly string[];
  deafened: boolean;
  /** Master playback level for this call; card levels remain unchanged. */
  outputVolume: number;
  fullscreen: boolean;
  levelFor: (cardId: string) => PlaybackLevel;
  onLevel: (cardId: string, patch: Partial<PlaybackLevel>) => void;
  onPin: (cardId: string | null) => void;
  /** Grid mode: "auto" fits every card, a number fixes the cards per screen. */
  gridCapacity: GridCapacity;
  /** Actions for the right-click / long-press menu of a card. */
  menuFor: (card: MeetingCard) => readonly MenuItem[];
}

export type GridCapacity = "auto" | 4 | 9 | 16;

const GRID_GAP = 12;
const ASPECT = 16 / 9;

/** Picks the column count that gives the largest 16:9 card for `count` cards in a w×h box. */
export function gridShape(count: number, capacity: GridCapacity, width: number, height: number) {
  const fit = (cols: number, rows: number) => Math.max(0, Math.min((width - GRID_GAP * (cols - 1)) / cols, ((height - GRID_GAP * (rows - 1)) / rows) * ASPECT));
  if (capacity !== "auto") {
    const side = Math.sqrt(capacity);
    return { cols: side, cardWidth: fit(side, side) };
  }
  const n = Math.max(1, count);
  let best = { cols: 1, cardWidth: 0 };
  for (let cols = 1; cols <= n; cols += 1) {
    const cardWidth = fit(cols, Math.ceil(n / cols));
    if (cardWidth > best.cardWidth) best = { cols, cardWidth };
  }
  return best;
}

function CardGrid(props: { count: number; capacity: GridCapacity; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const { cols, cardWidth } = gridShape(props.count, props.capacity, box.width, box.height);
  const style =
    cardWidth > 0 ? { gridTemplateColumns: `repeat(${cols}, ${Math.floor(cardWidth)}px)`, gridAutoRows: `${Math.floor(cardWidth / ASPECT)}px` } : undefined;
  return (
    <div ref={ref} className="card-grid" style={style}>
      {props.children}
    </div>
  );
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
      origin={props.origin}
      avatarId={props.avatarFor(card.identity)}
      account={props.accountFor(card.identity)}
      size={size}
      video={card.videoId === null ? undefined : tileById.get(card.videoId)}
      pinned={props.pinnedId === card.id}
      speaking={card.kind === "person" && props.speakers.includes(card.identity)}
      playback={props.levelFor(card.id)}
      onLevel={(patch) => props.onLevel(card.id, patch)}
      onPin={() => props.onPin(props.pinnedId === card.id ? null : card.id)}
      menu={() => props.menuFor(card)}
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
        <CardGrid count={others.length} capacity={props.gridCapacity}>
          {others.map((card) => render(card, "grid"))}
        </CardGrid>
      )}
      {props.cards.flatMap((card) =>
        card.audioIds.flatMap((id) => {
          const tile = tileById.get(id);
          return tile === undefined || !shouldAttachPlayback(tile)
            ? []
            : [<AudioSink key={id} tile={tile} playback={effectivePlayback(props.levelFor(card.id), props.deafened, props.outputVolume)} />];
        }),
      )}
    </div>
  );
}

function CardView(props: {
  card: MeetingCard;
  origin: string | null;
  avatarId: string | null;
  account: string | null;
  size: "center" | "strip" | "grid";
  video: TrackTile | undefined;
  pinned: boolean;
  speaking: boolean;
  playback: PlaybackLevel;
  onLevel: (patch: Partial<PlaybackLevel>) => void;
  onPin: () => void;
  menu: () => readonly MenuItem[];
}) {
  const { card } = props;
  const context = useContextMenu(props.menu);
  const live = props.video !== undefined && shouldShowLiveVideo(props.video);
  const hearable = (card.kind === "person" || card.kind === "radio") && !card.local && card.audioIds.length > 0;
  const name =
    card.kind === "share"
      ? `Tela de ${card.label}`
      : card.kind === "radio"
        ? card.local
          ? "Seu rádio"
          : `Rádio de ${card.label}`
        : card.local
          ? `${card.label} (você)`
          : card.label;
  return (
    <article
      {...context.handlers}
      className={`card ${props.size}${props.pinned ? " pinned" : ""}${props.speaking ? " speaking" : ""}${card.kind === "share" ? " share" : ""}${card.kind === "radio" ? " radio" : ""}`}
    >
      {live && props.video ? (
        <VideoSink tile={props.video} />
      ) : (
        <div className="avatar" aria-hidden="true">
          <span>
            <Face origin={props.origin} imageId={props.avatarId} label={card.label} />
          </span>
        </div>
      )}
      <footer>
        <span className="name" title={props.account !== null && props.account !== card.label ? `Conta: ${props.account}` : undefined}>
          {name}
        </span>
        {props.speaking ? <span className="sr">falando</span> : null}
        {hearable && !props.playback.heard ? <span className="badge">mudo aqui</span> : null}
        <Button appearance="subtle" size="small" aria-pressed={props.pinned} onClick={props.onPin}>
          {props.pinned ? "Soltar" : "Fixar"}
        </Button>
      </footer>
      {hearable && props.size !== "strip" ? (
        <div className="card-audio">
          <Button appearance="subtle" size="small" onClick={() => props.onLevel({ heard: !props.playback.heard })}>
            {props.playback.heard ? "Silenciar neste PC" : "Voltar a ouvir"}
          </Button>
          <label>
            <span className="sr">Volume neste PC</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(props.playback.volume * 100)}
              aria-label={`Volume de ${name} neste PC`}
              onChange={(event) => props.onLevel({ volume: Number(event.currentTarget.value) / 100 })}
            />
          </label>
        </div>
      ) : null}
      {context.menu}
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
