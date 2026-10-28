import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { LiveKitPocSession } from "@openmeet/media";
import {
  SOUND_MAX_MS,
  SOUND_NAME_MAX,
  SOUND_SAMPLE_RATE,
  encodeSound,
  sniffSound,
  type MeetingModel,
  type OwnSound,
  type ServerSummary,
  type SoundSummary,
} from "@openmeet/shared";
import { Button, Field, Input, Select, Slider } from "@fluentui/react-components";
import { fetchSound } from "../shell/native";
import { base64 } from "./images";

// ADR 0021: the library of the call's server. Sounds are fetched with the session (Rust in the .exe,
// cookie on the web) and kept for this window; an id never changes its bytes.
const loaded = new Map<string, Promise<Uint8Array>>();

function soundBytes(origin: string, id: string): Promise<Uint8Array> {
  const key = `${origin} ${id}`;
  const hit = loaded.get(key);
  if (hit) return hit;
  const next = fetchSound(origin, id).then((bytes) => {
    if (!sniffSound(bytes)) throw new Error("invalid_sound");
    return bytes;
  });
  next.catch(() => loaded.delete(key));
  loaded.set(key, next);
  return next;
}

/** Any file the browser decodes, as the canonical WAV: 24 kHz mono 16-bit, refused past 20 s. */
export async function prepareSound(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  let decoded: AudioBuffer;
  try {
    // An offline context decodes straight to its own rate.
    decoded = await new OfflineAudioContext(1, 1, SOUND_SAMPLE_RATE).decodeAudioData(data);
  } catch {
    throw new Error("Este arquivo não é um áudio que o navegador consiga abrir.");
  }
  if (decoded.duration * 1000 > SOUND_MAX_MS) throw new Error("O som passa de 20 s. Corte o arquivo e tente de novo.");
  const frames = Math.max(1, Math.round(decoded.duration * SOUND_SAMPLE_RATE));
  const mono = new OfflineAudioContext(1, frames, SOUND_SAMPLE_RATE);
  const source = mono.createBufferSource();
  source.buffer = decoded;
  source.connect(mono.destination);
  source.start();
  const rendered = await mono.startRendering();
  return base64(encodeSound(rendered.getChannelData(0)));
}

function defaultName(file: File): string {
  return file.name
    .replace(/\.[^.]+$/, "")
    .trim()
    .slice(0, SOUND_NAME_MAX);
}

function seconds(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1).replace(".", ",")} s`;
}

export function SoundPanel(props: {
  model: MeetingModel;
  session: () => LiveKitPocSession;
  origin: string | null;
  serverId: string | null;
  servers: readonly ServerSummary[];
  playing: string | null;
  volume: number;
  onError: (message: string | null) => void;
}) {
  const { model, session, origin, serverId, servers, playing, volume, onError } = props;
  const [open, setOpen] = useState(false);
  const [sounds, setSounds] = useState<SoundSummary[] | null>(null);
  const [own, setOwn] = useState<OwnSound[]>([]);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [target, setTarget] = useState<Record<string, string>>({});
  // Deleting removes the sound from every server, so it takes a second click.
  const [confirming, setConfirming] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (serverId === null) return;
    const [library, mine] = await Promise.all([model.listSounds(serverId), model.listOwnSounds()]);
    setSounds(library);
    if (mine) setOwn(mine);
  }, [model, serverId]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  async function act(run: () => Promise<boolean>, failure: string): Promise<void> {
    setBusy(true);
    onError(null);
    try {
      if (!(await run())) onError(failure);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function play(sound: SoundSummary): Promise<void> {
    if (origin === null) return;
    onError(null);
    try {
      await session().playSound(sound.id, await soundBytes(origin, sound.id));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      onError(message === "microphone_unavailable" ? "Ligue o microfone uma vez nesta reunião para tocar sons." : "Não foi possível tocar este som.");
    }
  }

  async function upload(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (file === null || serverId === null) return;
    setBusy(true);
    onError(null);
    try {
      const sound = await prepareSound(file);
      if (await model.uploadSound(serverId, name.trim(), sound)) {
        setFile(null);
        setName("");
        await reload();
      } else {
        onError("O servidor recusou o som. Confira o nome e tente de novo.");
      }
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Não foi possível preparar o som.");
    } finally {
      setBusy(false);
    }
  }

  const memberOf = new Set(servers.map((server) => server.id));

  return (
    <details className="more sounds" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="ctl" aria-label="Sons" title="Sons">
        <svg
          width={22}
          height={22}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </summary>
      <div className="more-body sound-panel">
        <Field label={`Volume dos sons: ${Math.round(volume * 100)}%`}>
          <Slider
            min={0}
            max={100}
            step={1}
            value={Math.round(volume * 100)}
            aria-valuetext={`${Math.round(volume * 100)}%`}
            onChange={(_, data) => {
              const value = data.value / 100;
              session().setSoundVolume(value);
              try {
                localStorage.setItem(SOUND_VOLUME_KEY, String(value));
              } catch {
                // The choice still holds for this window.
              }
            }}
          />
        </Field>
        {playing !== null ? (
          <Button appearance="primary" onClick={() => session().stopSound()}>
            Parar som
          </Button>
        ) : null}

        <h3>Biblioteca deste servidor</h3>
        {sounds === null ? (
          <p className="hint">Carregando…</p>
        ) : sounds.length === 0 ? (
          <p className="hint">Nenhum som ainda. Envie o primeiro abaixo.</p>
        ) : (
          <ul className="sound-list">
            {sounds.map((sound) => (
              <li key={sound.id}>
                <button type="button" className={playing === sound.id ? "on" : ""} disabled={busy} onClick={() => void play(sound)}>
                  ▶ {sound.name} <span className="hint">{seconds(sound.durationMs)}</span>
                </button>
                {sound.canRemove ? (
                  <Button
                    appearance="subtle"
                    size="small"
                    disabled={busy}
                    aria-label={`Tirar ${sound.name} deste servidor`}
                    onClick={() =>
                      void act(() => (serverId === null ? Promise.resolve(false) : model.removeSound(serverId, sound.id)), "Não foi possível tirar o som.")
                    }
                  >
                    Tirar
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <form className="sound-upload" onSubmit={(event) => void upload(event)}>
          <h3>Enviar som</h3>
          <input
            type="file"
            accept="audio/*"
            disabled={busy}
            onChange={(event) => {
              const picked = event.currentTarget.files?.[0] ?? null;
              setFile(picked);
              if (picked && name.trim() === "") setName(defaultName(picked));
            }}
          />
          <Field label="Nome">
            <Input value={name} maxLength={SOUND_NAME_MAX} disabled={busy} onChange={(_, data) => setName(data.value)} />
          </Field>
          <Button type="submit" appearance="primary" disabled={busy || file === null || name.trim() === ""}>
            {busy ? "Enviando…" : "Enviar para este servidor"}
          </Button>
          <p className="hint">Até 20 s. Todos os membros do servidor podem tocar o som.</p>
        </form>

        {own.length > 0 ? (
          <>
            <h3>Meus sons</h3>
            <ul className="sound-list">
              {own.map((sound) => {
                const elsewhere = servers.filter((server) => !sound.serverIds.includes(server.id));
                const chosen = target[sound.id] ?? elsewhere[0]?.id ?? "";
                return (
                  <li key={sound.id}>
                    <span>
                      {sound.name} <span className="hint">{seconds(sound.durationMs)}</span>
                    </span>
                    {elsewhere.length > 0 ? (
                      <>
                        <Select
                          size="small"
                          aria-label={`Servidor para importar ${sound.name}`}
                          value={chosen}
                          disabled={busy}
                          onChange={(_, data) => setTarget({ ...target, [sound.id]: data.value })}
                        >
                          {elsewhere.map((server) => (
                            <option key={server.id} value={server.id}>
                              {server.name}
                            </option>
                          ))}
                        </Select>
                        <Button
                          size="small"
                          disabled={busy || !memberOf.has(chosen)}
                          onClick={() => void act(() => model.importSound(chosen, sound.id), "Não foi possível importar o som.")}
                        >
                          Importar
                        </Button>
                      </>
                    ) : null}
                    <Button
                      appearance="subtle"
                      size="small"
                      className="danger-text"
                      disabled={busy}
                      aria-label={
                        confirming === sound.id ? `Confirmar: apagar ${sound.name} de todos os servidores` : `Apagar ${sound.name} de todos os servidores`
                      }
                      onClick={() => {
                        if (confirming !== sound.id) {
                          setConfirming(sound.id);
                          return;
                        }
                        setConfirming(null);
                        void act(() => model.deleteSound(sound.id), "Não foi possível apagar o som.");
                      }}
                      onBlur={() => setConfirming((current) => (current === sound.id ? null : current))}
                    >
                      {confirming === sound.id ? "Apagar de todos?" : "Apagar"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </div>
    </details>
  );
}

export const SOUND_VOLUME_KEY = "openmeet.soundVolume";

/** The panel volume saved on this device, 0–1; 1 when nothing valid is saved. */
export function storedSoundVolume(): number {
  try {
    const saved = Number(localStorage.getItem(SOUND_VOLUME_KEY));
    return localStorage.getItem(SOUND_VOLUME_KEY) !== null && Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : 1;
  } catch {
    return 1;
  }
}
