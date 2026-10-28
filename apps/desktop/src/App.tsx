import { lazy, Suspense } from "react";
import { FluentProvider, makeStyles, webDarkTheme } from "@fluentui/react-components";
import { MeetingApp } from "./meeting/MeetingApp";
import { UpdateNotice } from "./shell/UpdateNotice";
import "./App.css";

// S-13: the media proof never ships in the installer. A production build replaces DEV with false,
// so this branch, the dynamic import and the module are all dropped from the bundle.
const PocApp = import.meta.env.DEV ? lazy(() => import("./poc/PocApp").then((module) => ({ default: module.PocApp }))) : null;

// ADR 0026: dark only until every screen is on Fluent; the legacy CSS still paints the backgrounds.
const useStyles = makeStyles({ provider: { backgroundColor: "transparent", color: "inherit" } });

export default function App() {
  const styles = useStyles();
  const poc = PocApp !== null && new URLSearchParams(window.location.search).get("poc") === "1";
  return poc ? (
    <Suspense fallback={null}>
      <PocApp />
    </Suspense>
  ) : (
    <FluentProvider theme={webDarkTheme} className={styles.provider}>
      <MeetingApp />
      {__WEB__ ? null : <UpdateNotice />}
    </FluentProvider>
  );
}
