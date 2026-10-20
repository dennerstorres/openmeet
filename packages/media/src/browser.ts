// ADR 0014: the web client runs in Chrome, Edge or Firefox, and each gives a different part of the media.
// What is missing is hidden instead of failing at the click.

export type BrowserName = "edge" | "chrome" | "firefox" | "safari" | "other";

export interface BrowserMedia {
  name: BrowserName;
  /** Major version, or null when the user agent does not say. */
  version: string | null;
  /** The output device selector needs HTMLMediaElement.setSinkId. */
  outputSelection: boolean;
  /** PC or tab audio with the screen: Chromium (Chrome, Edge, WebView2) delivers it, Firefox and Safari do not. */
  screenAudio: boolean;
}

export interface BrowserFeatures {
  userAgent: string;
  setSinkId: boolean;
  getDisplayMedia: boolean;
}

function browserFrom(userAgent: string): { name: BrowserName; version: string | null } {
  const rules: Array<[BrowserName, RegExp]> = [
    ["firefox", /\bFirefox\/(\d+)/],
    ["edge", /\bEdg\/(\d+)/],
    ["chrome", /\bChrome\/(\d+)/],
    ["safari", /\bVersion\/(\d+)[^ ]* (?:Mobile\/\S+ )?Safari\//],
  ];
  for (const [name, pattern] of rules) {
    const match = pattern.exec(userAgent);
    if (match) return { name, version: match[1] ?? null };
  }
  return { name: "other", version: null };
}

export function detectBrowserMedia(features: BrowserFeatures): BrowserMedia {
  const { name, version } = browserFrom(features.userAgent);
  const chromium = name === "chrome" || name === "edge";
  return {
    name,
    version,
    outputSelection: features.setSinkId,
    screenAudio: features.getDisplayMedia && chromium,
  };
}

/** `edge 141`, for the diagnostic and the device panel. */
export function browserLabel(browser: BrowserMedia): string {
  return browser.version === null ? browser.name : `${browser.name} ${browser.version}`;
}

export function readBrowserMedia(): BrowserMedia {
  const userAgent = typeof navigator === "undefined" ? "" : String(navigator.userAgent ?? "");
  const setSinkId = typeof HTMLMediaElement !== "undefined" && typeof (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId === "function";
  const getDisplayMedia = typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
  return detectBrowserMedia({ userAgent, setSinkId, getDisplayMedia });
}
