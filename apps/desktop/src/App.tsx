import { lazy, Suspense } from "react";
import { FluentProvider, createDarkTheme, makeStyles, type BrandVariants } from "@fluentui/react-components";
import { MeetingApp } from "./meeting/MeetingApp";
import { UpdateNotice } from "./shell/UpdateNotice";
import "./App.css";

// S-13: the media proof never ships in the installer. A production build replaces DEV with false,
// so this branch, the dynamic import and the module are all dropped from the bundle.
const PocApp = import.meta.env.DEV ? lazy(() => import("./poc/PocApp").then((module) => ({ default: module.PocApp }))) : null;

// ADR 0026: dark only until every screen is on Fluent; the legacy CSS still paints the backgrounds.
// Brand ramp around the app accent (#15803d), so primary buttons keep the OpenMeet green.
const brand: BrandVariants = {
  10: "#020a05",
  20: "#04170b",
  30: "#062410",
  40: "#083216",
  50: "#0b401c",
  60: "#0d4f23",
  70: "#105f2a",
  80: "#126f31",
  90: "#15803d",
  100: "#1f9148",
  110: "#2ea257",
  120: "#45b36a",
  130: "#62c381",
  140: "#84d29b",
  150: "#a8e0b7",
  160: "#cdeed6",
};
// Neutrals follow the app palette in App.css, so fields, buttons, menus and dialogs share one surface and border.
const stroke = "#3a423f";
const strokeHover = "#4b5551";
const theme = {
  ...createDarkTheme(brand),
  colorBrandForeground1: brand[120],
  colorBrandForeground2: brand[130],
  colorNeutralForeground1: "#eef3f0",
  colorNeutralForeground2: "#d5ddd8",
  colorNeutralForeground3: "#aab5af",
  colorNeutralForeground4: "#8a9690",
  colorNeutralBackground1: "#1f2423",
  colorNeutralBackground1Hover: "#2e3532",
  colorNeutralBackground1Pressed: "#38403d",
  colorNeutralBackground1Selected: "#38403d",
  colorNeutralBackground2: "#1a1f1e",
  colorNeutralBackground3: "#151918",
  colorSubtleBackgroundHover: "#2e3532",
  colorSubtleBackgroundPressed: "#38403d",
  colorSubtleBackgroundSelected: "#38403d",
  colorNeutralStroke1: stroke,
  colorNeutralStroke1Hover: strokeHover,
  colorNeutralStroke1Pressed: strokeHover,
  colorNeutralStrokeAccessible: stroke,
  colorNeutralStrokeAccessibleHover: strokeHover,
  colorNeutralStrokeAccessiblePressed: strokeHover,
};

const useStyles = makeStyles({ provider: { backgroundColor: "transparent", color: "inherit" } });

export default function App() {
  const styles = useStyles();
  const poc = PocApp !== null && new URLSearchParams(window.location.search).get("poc") === "1";
  return poc ? (
    <Suspense fallback={null}>
      <PocApp />
    </Suspense>
  ) : (
    <FluentProvider theme={theme} className={styles.provider}>
      <MeetingApp />
      {__WEB__ ? null : <UpdateNotice />}
    </FluentProvider>
  );
}
