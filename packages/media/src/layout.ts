export interface LayoutTile {
  id: string;
  source: string;
  media: string;
  local: boolean;
  surface?: string | null;
}

export interface TilePlacement {
  stageId: string | null;
  gridIds: string[];
}

export function arrangeTiles(tiles: readonly LayoutTile[]): TilePlacement {
  const videos = tiles.filter((tile) => tile.media === "video");
  const screens = videos.filter((tile) => tile.source === "screen");
  const stage = screens.find((tile) => !tile.local) ?? screens[0] ?? null;
  return {
    stageId: stage?.id ?? null,
    gridIds: videos.filter((tile) => tile.id !== stage?.id).map((tile) => tile.id),
  };
}

export type ScreenAudioState = "off" | "on" | "missing";

/** ADR 0008. Asked for the PC audio and the source gave none: the image goes on, and that is not a success. */
export function screenAudioState(sharing: boolean, requested: boolean, published: boolean): ScreenAudioState {
  if (!sharing || !requested) return "off";
  return published ? "on" : "missing";
}

export function screenShareAction(sharing: boolean): "start" | "stop" {
  return sharing ? "stop" : "start";
}

export function screenSourceLabel(surface: string | null): string {
  if (surface === "monitor") return "monitor";
  if (surface === "window") return "janela";
  if (surface === "browser") return "guia";
  return "tela";
}

export function localScreenSurface(tiles: readonly LayoutTile[]): string | null {
  const tile = tiles.find((item) => item.local && item.source === "screen" && item.media === "video");
  return tile?.surface ?? null;
}

export function screenCaption(surface: string | null, sharing: boolean): string | null {
  if (!sharing) return null;
  return `Compartilhando ${screenSourceLabel(surface)}`;
}

// ADR 0009: one card per person, one card per screen share. ADR 0022: one card per radio.

export interface CardPerson {
  identity: string;
  label: string;
  local?: boolean;
}

export interface CardTile extends LayoutTile {
  identity: string;
  label: string;
}

export interface MeetingCard {
  id: string;
  kind: "person" | "share" | "radio";
  identity: string;
  label: string;
  local: boolean;
  /** Camera for a person, screen for a share. */
  videoId: string | null;
  /** Microphone for a person, screen audio for a share, the radio track for a radio. */
  audioIds: string[];
}

export type CardLayout = "spotlight" | "grid";

export interface CardPlacement {
  featuredId: string | null;
  /** Spotlight: the strip without the featured card. Grid: every card. */
  others: string[];
}

export function buildCards(people: readonly CardPerson[], tiles: readonly CardTile[]): MeetingCard[] {
  const persons = new Map<string, MeetingCard>();
  const personFor = (identity: string, label: string, local: boolean): MeetingCard => {
    let card = persons.get(identity);
    if (card === undefined) {
      card = { id: `person:${identity}`, kind: "person", identity, label, local, videoId: null, audioIds: [] };
      persons.set(identity, card);
    }
    return card;
  };
  for (const person of people) personFor(person.identity, person.label, person.local === true);
  const shares: MeetingCard[] = [];
  const radios: MeetingCard[] = [];
  for (const tile of tiles) {
    if (tile.source === "radio") {
      radios.push({ id: `radio:${tile.id}`, kind: "radio", identity: tile.identity, label: tile.label, local: tile.local, videoId: null, audioIds: [tile.id] });
      continue;
    }
    if (tile.source === "screen" && tile.media === "video") {
      shares.push({ id: `share:${tile.id}`, kind: "share", identity: tile.identity, label: tile.label, local: tile.local, videoId: tile.id, audioIds: [] });
      continue;
    }
    if (tile.source === "screen-audio") continue;
    const card = personFor(tile.identity, tile.label, tile.local);
    if (tile.local) card.local = true;
    if (tile.media === "video" && card.videoId === null) card.videoId = tile.id;
    else if (tile.media === "audio") card.audioIds.push(tile.id);
  }
  for (const tile of tiles) {
    if (tile.source !== "screen-audio") continue;
    const share = shares.find((card) => card.identity === tile.identity);
    if (share) share.audioIds.push(tile.id);
    else personFor(tile.identity, tile.label, tile.local).audioIds.push(tile.id);
  }
  return [...shares, ...persons.values(), ...radios];
}

/** The pinned card wins while it exists. Then another person's share, then another person's camera, then your own share, then another person, then yourself. */
export function featuredCard(cards: readonly MeetingCard[], pinnedId: string | null): string | null {
  const pinned = pinnedId === null ? undefined : cards.find((card) => card.id === pinnedId);
  if (pinned) return pinned.id;
  const share = cards.find((card) => card.kind === "share" && !card.local);
  if (share) return share.id;
  const camera = cards.find((card) => card.kind === "person" && !card.local && card.videoId !== null);
  if (camera) return camera.id;
  const ownShare = cards.find((card) => card.kind === "share");
  if (ownShare) return ownShare.id;
  // A radio has nothing to show: it is featured only when pinned.
  const people = cards.filter((card) => card.kind !== "radio");
  const other = people.find((card) => !card.local);
  return other?.id ?? people[0]?.id ?? null;
}

export function placeCards(cards: readonly MeetingCard[], layout: CardLayout, pinnedId: string | null): CardPlacement {
  const ordered = [
    ...cards.filter((card) => card.kind === "share"),
    ...cards.filter((card) => card.kind === "person"),
    ...cards.filter((card) => card.kind === "radio"),
  ].map((card) => card.id);
  if (layout === "grid") return { featuredId: null, others: ordered };
  const featuredId = featuredCard(cards, pinnedId);
  return { featuredId, others: ordered.filter((id) => id !== featuredId) };
}

/** A pin lasts until it is released or its card leaves. */
export function keepPin(cards: readonly MeetingCard[], pinnedId: string | null): string | null {
  return pinnedId !== null && cards.some((card) => card.id === pinnedId) ? pinnedId : null;
}

export function cardInitial(label: string): string {
  const first = label.trim().codePointAt(0);
  return first === undefined ? "?" : String.fromCodePoint(first).toLocaleUpperCase("pt-BR");
}
