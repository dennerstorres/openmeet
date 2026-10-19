import { MeetingApp } from "./meeting/MeetingApp";
import { PocApp } from "./poc/PocApp";
import "./App.css";

export default function App() {
  const poc = new URLSearchParams(window.location.search).get("poc") === "1";
  return poc ? <PocApp /> : <MeetingApp />;
}
