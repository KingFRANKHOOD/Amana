export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then(() => {
        console.log("[SW] Service worker registered");
      })
      .catch((err) => {
        console.warn("[SW] Service worker registration failed:", err);
      });
  });
}
