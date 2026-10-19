// WebView2 suspends a hidden document. A held Web Lock keeps mute and camera reachable from the tray.
export function holdMeetingLock(): () => void {
  const controller = new AbortController();
  const locks = navigator.locks;
  if (locks !== undefined) {
    void locks.request("openmeet-meeting", { signal: controller.signal }, () => new Promise<void>(() => {})).catch(() => undefined);
  }
  return () => {
    controller.abort();
  };
}
