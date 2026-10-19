import { lazy, Suspense } from "react";
import { MeetingApp } from "./meeting/MeetingApp";
import "./App.css";

// S-13: the media proof never ships in the installer. A production build replaces DEV with false,
// so this branch, the dynamic import and the module are all dropped from the bundle.
const PocApp = import.meta.env.DEV ? lazy(() => import("./poc/PocApp").then((module) => ({ default: module.PocApp }))) : null;

export default function App() {
  const poc = PocApp !== null && new URLSearchParams(window.location.search).get("poc") === "1";
  return poc ? (
    <Suspense fallback={null}>
      <PocApp />
    </Suspense>
  ) : (
    <MeetingApp />
  );
}
