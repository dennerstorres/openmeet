import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { registerServiceWorker } from "./web/pwa";

// ADR 0027: only the built web client registers the service worker; Vite dev and the .exe never do.
if (__WEB__ && import.meta.env.PROD) void registerServiceWorker().catch(() => undefined);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
