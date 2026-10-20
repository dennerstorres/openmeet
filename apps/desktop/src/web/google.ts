/**
 * ADR 0014: Google opens in a new browser window. The window is opened in the click itself, before the
 * start call returns, because browsers block a window opened later. It starts blank, loses its opener, and
 * only then goes to Google. If the start fails, the blank window closes.
 */
export function prepareGoogleWindow(): { open: (url: string) => Promise<void>; dispose: () => void } {
  const popup = window.open("about:blank", "_blank");
  if (popup !== null) popup.opener = null;
  let used = false;
  return {
    async open(url) {
      used = true;
      if (popup !== null && !popup.closed) popup.location.replace(url);
      else window.open(url, "_blank", "noopener,noreferrer");
    },
    dispose() {
      if (!used && popup !== null && !popup.closed) popup.close();
    },
  };
}
