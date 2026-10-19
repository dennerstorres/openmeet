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
