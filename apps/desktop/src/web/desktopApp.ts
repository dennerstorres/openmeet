// The installer ships only for Windows (docs/RELEASE.md). The release page keeps one address across versions.
export const DESKTOP_DOWNLOAD_URL = "https://github.com/dennerstorres/openmeet/releases/latest";

const OFFER_KEY = "openmeet.desktop-offer";

export function isWindowsDesktop(agent: string = navigator.userAgent): boolean {
  return /Windows NT/.test(agent) && !/Mobile|Windows Phone/.test(agent);
}

export function offerDismissed(): boolean {
  try {
    return localStorage.getItem(OFFER_KEY) === "dismissed";
  } catch {
    return false;
  }
}

export function dismissOffer(): void {
  try {
    localStorage.setItem(OFFER_KEY, "dismissed");
  } catch {
    // Without storage the offer comes back on the next visit.
  }
}
