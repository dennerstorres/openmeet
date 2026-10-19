import { parseApiBase, parseIdentity, parseJoinResponse, parsePastedJoin, parseRoomName, PocInputError } from "@openmeet/shared";
import {
  describeMediaError,
  EMPTY_RECONNECT,
  emptyStats,
  LiveKitPocSession,
  mediaActionError,
  type DeviceKind,
  type DeviceOption,
  type PocSnapshot,
} from "@openmeet/media";
import desktopPackage from "../../package.json";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { TrackView } from "./TrackView";

const idleSnapshot: PocSnapshot = {
  phase: "idle",
  disconnectReason: null,
  tiles: [],
  participants: [],
  diagnostics: [],
  devices: [],
  stats: emptyStats(),
  reconnect: EMPTY_RECONNECT,
  microphone: false,
  audioPlayback: true,
  camera: false,
  screen: false,
};

export function PocApp() {
  const sessionRef = useRef<LiveKitPocSession | null>(null);
  const [snapshot, setSnapshot] = useState<PocSnapshot>(idleSnapshot);
  const [apiBase, setApiBase] = useState("http://127.0.0.1:3000");
  const [room, setRoom] = useState("poc");
  const [identity, setIdentity] = useState("");
  const [signalUrl, setSignalUrl] = useState("ws://127.0.0.1:7880");
  const [pastedToken, setPastedToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function session(): LiveKitPocSession {
    sessionRef.current ??= new LiveKitPocSession({ appVersion: desktopPackage.version });
    return sessionRef.current;
  }

  useEffect(() => {
    return session().subscribe(setSnapshot);
  }, []);

  useEffect(() => {
    if (snapshot.phase !== "connected" && snapshot.phase !== "reconnecting") {
      return;
    }
    const timer = window.setInterval(() => {
      void session()
        .refreshStats()
        .catch((caught: unknown) => {
          setError(describeMediaError(caught));
        });
    }, 5000);
    return () => {
      window.clearInterval(timer);
    };
  }, [snapshot.phase]);

  async function connect(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const pasted = pastedToken.trim();
      const join = pasted.length > 0 ? parsePastedJoin(signalUrl, pasted) : await requestJoin(apiBase, room, identity);
      await session().connect(join.url, join.token);
      await session().refreshDevices();
    } catch (caught) {
      setError(caught instanceof PocInputError ? caught.code : caught instanceof Error ? caught.message : "connect_failed");
    }
  }

  async function refreshDevices() {
    try {
      await session().refreshDevices();
    } catch (caught) {
      setError(describeMediaError(caught));
    }
  }

  async function runMedia(action: "microphone" | "camera" | "screen", work: () => Promise<void>) {
    setPending(true);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(mediaActionError(action, caught));
    } finally {
      setPending(false);
    }
  }

  async function onDevice(kind: DeviceKind, deviceId: string) {
    if (deviceId.length === 0) {
      return;
    }
    try {
      await session().selectDevice(kind, deviceId);
    } catch (caught) {
      setError(describeMediaError(caught));
    }
  }

  const connected = snapshot.phase === "connected" || snapshot.phase === "reconnecting";

  return (
    <main className="poc">
      <header>
        <h1>OpenMeet POC</h1>
        <p>Fase de prova. Áudio, câmera e tela só contam depois do teste manual.</p>
        <p>
          Estado: <strong>{snapshot.phase}</strong>
          {snapshot.disconnectReason ? ` · ${snapshot.disconnectReason}` : ""}
        </p>
      </header>

      <form onSubmit={(event) => void connect(event)}>
        <label>
          API
          <input value={apiBase} onChange={(event) => setApiBase(event.currentTarget.value)} />
        </label>
        <label>
          Sala
          <input value={room} onChange={(event) => setRoom(event.currentTarget.value)} />
        </label>
        <label>
          Identidade
          <input value={identity} onChange={(event) => setIdentity(event.currentTarget.value)} placeholder="win-a" />
        </label>
        <label>
          URL do sinal
          <input value={signalUrl} onChange={(event) => setSignalUrl(event.currentTarget.value)} />
        </label>
        <label className="token">
          Token
          <textarea
            value={pastedToken}
            onChange={(event) => setPastedToken(event.currentTarget.value)}
            rows={3}
            spellCheck={false}
            autoComplete="off"
            placeholder="vazio neste PC; no outro, cola o token"
          />
        </label>
        <button type="submit" disabled={connected || snapshot.phase === "connecting"}>
          Entrar
        </button>
        <button
          type="button"
          onClick={() => {
            void session().disconnect();
          }}
        >
          Sair
        </button>
      </form>
      {error ? <p className="error">{error}</p> : null}

      <section>
        <h2>Controles</h2>
        {snapshot.audioPlayback ? null : (
          <button type="button" onClick={() => void session().startRemoteAudio().catch((caught: unknown) => setError(mediaActionError("audio", caught)))}>
            Ativar som
          </button>
        )}
        <button type="button" disabled={!connected || pending} onClick={() => void runMedia("microphone", () => session().setMicrophone(!snapshot.microphone))}>
          Microfone {snapshot.microphone ? "ligado" : "desligado"}
        </button>
        <button type="button" disabled={!connected || pending} onClick={() => void runMedia("camera", () => session().setCamera(!snapshot.camera))}>
          Câmera {snapshot.camera ? "ligada" : "desligada"}
        </button>
        <button type="button" disabled={!connected || pending} onClick={() => void runMedia("screen", () => session().setScreenShare(!snapshot.screen))}>
          {snapshot.screen ? "Parar compartilhamento" : "Compartilhar tela"}
        </button>
        <button type="button" onClick={() => void refreshDevices()}>
          Atualizar dispositivos
        </button>
        <DeviceSelect label="Entrada" kind="audioinput" devices={snapshot.devices} onChange={onDevice} />
        <DeviceSelect label="Saída" kind="audiooutput" devices={snapshot.devices} onChange={onDevice} />
        <DeviceSelect label="Câmera" kind="videoinput" devices={snapshot.devices} onChange={onDevice} />
      </section>

      <section>
        <h2>Participantes</h2>
        {snapshot.participants.length === 0 ? (
          <p>Ninguém na sala.</p>
        ) : (
          <ul>
            {snapshot.participants.map((person) => (
              <li key={person.identity}>{person.label}</li>
            ))}
          </ul>
        )}
        <div className="tiles">
          {snapshot.tiles.map((tile) => (
            <TrackView key={tile.id} tile={tile} />
          ))}
        </div>
      </section>

      <section>
        <h2>Métricas</h2>
        <p>
          {snapshot.stats.userAgent ?? "user agent indisponível"} · app {snapshot.stats.appVersion ?? "—"}
        </p>
        {snapshot.stats.available ? (
          <p>
            perda {snapshot.stats.packetsLost ?? "—"} · jitter {snapshot.stats.jitterMs ?? "—"} ms · RTT {snapshot.stats.rttMs ?? "—"} ms · candidato{" "}
            {snapshot.stats.candidateType ?? "—"} · saída {snapshot.stats.outboundWidth ?? "—"}x{snapshot.stats.outboundHeight ?? "—"} @{" "}
            {snapshot.stats.outboundFps ?? "—"} fps · superfície {snapshot.stats.displaySurface ?? "—"}
          </p>
        ) : (
          <p>Métricas ainda não disponíveis.</p>
        )}
      </section>

      <section>
        <h2>Diagnóstico</h2>
        <ol>
          {snapshot.diagnostics.map((entry, index) => (
            <li key={`${entry.at}-${index}`}>
              {entry.at} {entry.level}: {entry.message}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

async function requestJoin(apiBase: string, room: string, identity: string): Promise<{ url: string; token: string }> {
  const base = parseApiBase(apiBase);
  parseRoomName(room);
  parseIdentity(identity);
  const response = await fetch(new URL("/api/v1/poc/join", base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ room, identity }),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const code = typeof payload === "object" && payload !== null && "error" in payload ? String(payload.error) : String(response.status);
    throw new Error(code);
  }
  return parseJoinResponse(payload);
}

function DeviceSelect({
  label,
  kind,
  devices,
  onChange,
}: {
  label: string;
  kind: DeviceKind;
  devices: DeviceOption[];
  onChange: (kind: DeviceKind, deviceId: string) => Promise<void>;
}) {
  const options = devices.filter((device) => device.kind === kind);
  const active = options.find((device) => device.active);
  return (
    <label>
      {label}
      <select
        value={active?.deviceId ?? ""}
        onChange={(event) => {
          void onChange(kind, event.currentTarget.value);
        }}
      >
        <option value="">padrão</option>
        {options.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.active ? `${device.label} (ativo)` : device.label}
          </option>
        ))}
      </select>
    </label>
  );
}
