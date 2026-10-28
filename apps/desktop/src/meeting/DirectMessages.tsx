import { DM_GROUP_MAX, bumpDm, dmTitle, parseChatMessage, parseDm, upsertDm, type DmMember, type DmSummary, type MeetingModel } from "@openmeet/shared";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { ChatListener } from "./chat-events";
import { dmClosed, dmPeer } from "./dm-state";
import { IconAction } from "./fluent";
import { Button, Checkbox, Field, Input } from "@fluentui/react-components";
import { AddRegular, PeopleAddRegular, PeopleRegular } from "@fluentui/react-icons";
import { Face } from "./images";
import { TextRoom, type ChatPerson } from "./TextRoom";

// ADR 0024: DMs on screen. Their own entry above the servers, the list of conversations, groups up to 10 people
// and blocks. The messages are the text room screen pointed at /dms; the API decides who reads and writes.

type Subscribe = (listener: ChatListener) => () => void;

export const DM_NOTICE = "Mensagens diretas não têm criptografia de ponta a ponta: quem opera esta instância consegue lê-las.";

/** The caller's DMs and blocks, kept current by the session feed. */
export function useDirectMessages(model: MeetingModel, subscribe: Subscribe, selfId: string | null, origin: string | null) {
  const [dms, setDms] = useState<DmSummary[]>([]);
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    setDms([]);
    setBlocked(new Set());
    if (selfId === null || origin === null) return;
    let live = true;
    const load = async () => {
      const [list, blocks] = await Promise.all([model.listDms(), model.listBlocks()]);
      if (!live) return;
      if (list !== null) setDms(list);
      if (blocks !== null) setBlocked(new Set(blocks));
    };
    void load();
    const unsubscribe = subscribe({
      event(name, data) {
        if (name === "dm.created" || name === "dm.updated") {
          const dm = parseDm(data);
          if (dm) setDms((held) => upsertDm(held, dm, selfId));
          return;
        }
        if (name !== "message.created") return;
        const dmId = parseChatMessage(data)?.dmId;
        if (typeof dmId === "string") setDms((held) => bumpDm(held, dmId));
      },
      reset() {
        void load();
      },
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [model, subscribe, selfId, origin]);

  const keep = useCallback((dm: DmSummary) => setDms((held) => upsertDm(held, dm, selfId)), [selfId]);
  const drop = useCallback((id: string) => setDms((held) => held.filter((dm) => dm.id !== id)), []);
  const block = useCallback(
    async (userId: string, on: boolean) => {
      if (!(await model.setBlock(userId, on))) return;
      const blocks = await model.listBlocks();
      if (blocks !== null) setBlocked(new Set(blocks));
    },
    [model],
  );
  return { dms, blocked, keep, drop, block };
}

/** A pick of people, for a new group or one more member. `room` is how many more fit. */
export function PeoplePicker(props: {
  title: string;
  submit: string;
  candidates: readonly DmMember[];
  room: number;
  withName: boolean;
  busy?: boolean;
  onSubmit: (ids: string[], name: string) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const words = filter.trim().toLocaleLowerCase("pt-BR");
  const shown = props.candidates.filter((person) => words === "" || person.label.toLocaleLowerCase("pt-BR").includes(words));
  const full = picked.length >= props.room;
  return (
    <form
      className="inline-form people-picker"
      aria-label={props.title}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (picked.length > 0) props.onSubmit(picked, name.trim());
      }}
    >
      <strong>{props.title}</strong>
      {props.withName ? (
        <Field label="Nome do grupo (opcional)">
          <Input value={name} maxLength={80} onChange={(_, data) => setName(data.value)} />
        </Field>
      ) : null}
      <Field label="Buscar pessoa">
        <Input value={filter} onChange={(_, data) => setFilter(data.value)} autoFocus />
      </Field>
      {props.candidates.length === 0 ? (
        <p className="hint">Ninguém para chamar. Só entra quem divide um servidor com você.</p>
      ) : (
        <ul className="people-list">
          {shown.map((person) => {
            const checked = picked.includes(person.id);
            return (
              <li key={person.id}>
                <Checkbox
                  label={person.label}
                  checked={checked}
                  disabled={!checked && full}
                  onChange={() => setPicked((held) => (checked ? held.filter((id) => id !== person.id) : [...held, person.id]))}
                />
              </li>
            );
          })}
        </ul>
      )}
      <p className="hint">
        {picked.length} de até {props.room} {props.room === 1 ? "pessoa" : "pessoas"}
      </p>
      <div className="row">
        <Button type="submit" appearance="primary" disabled={picked.length === 0 || props.busy === true}>
          {props.submit}
        </Button>
        <Button appearance="subtle" onClick={props.onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/** The DM side of the room bar: the conversations, most recent first, and a new group. */
export function DmList(props: {
  model: MeetingModel;
  dms: readonly DmSummary[];
  selfId: string | null;
  origin: string | null;
  openId: string | null;
  /** ADR 0024 (F13-13): what each conversation shows as unread. */
  badge: (id: string) => { mentions: number; unread: boolean };
  candidates: readonly DmMember[];
  onOpen: (dm: DmSummary) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <header className="room-bar-head">
        <div>
          <strong>Mensagens diretas</strong>
        </div>
        <div className="room-head-actions">
          <IconAction label="Novo grupo" expanded={creating} icon={<AddRegular />} onClick={() => setCreating((held) => !held)} />
        </div>
      </header>
      {creating ? (
        <PeoplePicker
          title="Novo grupo"
          submit="Criar grupo"
          candidates={props.candidates}
          room={DM_GROUP_MAX - 1}
          withName
          busy={busy}
          onCancel={() => setCreating(false)}
          onSubmit={(ids, name) => {
            setBusy(true);
            // One person and no name is the direct DM with them; a name always makes a group.
            void props.model.openDm(ids, ids.length === 1 && name === "" ? undefined : name).then((dm) => {
              setBusy(false);
              if (dm === null) return;
              setCreating(false);
              props.onOpen(dm);
            });
          }}
        />
      ) : null}
      {props.dms.length === 0 ? <p className="hint">Nenhuma conversa ainda. Abra uma pelo membro de um servidor ou crie um grupo no +.</p> : null}
      <ul className="room-list dm-list" aria-label="Conversas">
        {props.dms.map((dm) => {
          const peer = dmPeer(dm, props.selfId);
          const title = dmTitle(dm, props.selfId);
          const badge = props.badge(dm.id);
          return (
            <li key={dm.id} className="room-row">
              <button
                type="button"
                className={`room-item${dm.id === props.openId ? " active" : ""}${badge.unread ? " unread" : ""}`}
                aria-current={dm.id === props.openId ? "page" : undefined}
                onClick={() => props.onOpen(dm)}
              >
                <span className="dm-face" aria-hidden="true">
                  {peer ? <Face origin={props.origin} imageId={peer.avatarId} label={peer.label} /> : <PeopleRegular fontSize={16} />}
                </span>
                <span className="room-name">{title}</span>
                {dm.kind === "group" ? <span className="dm-size">{dm.members.length}</span> : null}
                {dm.readOnly ? <span className="badge">só leitura</span> : null}
                {badge.unread ? <span className="pill-dot" aria-label="Mensagens não lidas" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Actions on a member of the server: open the DM with them, block or unblock. */
export function MemberCard(props: { label: string; blocked: boolean; onMessage: () => void; onBlock: (on: boolean) => void }) {
  return (
    <div className="member-card" role="group" aria-label={`Ações para ${props.label}`}>
      <Button appearance="primary" onClick={props.onMessage}>
        Mensagem direta
      </Button>
      <Button appearance="subtle" className={props.blocked ? undefined : "danger-text"} onClick={() => props.onBlock(!props.blocked)}>
        {props.blocked ? "Desbloquear" : "Bloquear"}
      </Button>
    </div>
  );
}

/** One DM on screen: the shared message screen, the "no E2EE" notice and the people of a group. */
export function DmChat(props: {
  model: MeetingModel;
  dm: DmSummary;
  selfId: string | null;
  origin: string | null;
  blocked: ReadonlySet<string>;
  candidates: readonly DmMember[];
  /** Someone who left the group still signs the messages they wrote. */
  fallback: (id: string) => ChatPerson;
  subscribe: Subscribe;
  /** ADR 0024 (F13-13): the notification level picker, next to the other actions. */
  notify?: ReactNode;
  onBlock: (userId: string, on: boolean) => void;
  onChanged: (dm: DmSummary) => void;
  onLeft: () => void;
  onClose: () => void;
}) {
  const { dm, selfId, model } = props;
  const [people, setPeople] = useState(false);
  const [adding, setAdding] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const peer = dmPeer(dm, selfId);
  const iBlocked = peer !== null && props.blocked.has(peer.id);
  const creator = dm.createdBy === selfId;
  const title = dmTitle(dm, selfId);
  const closed = dmClosed(dm, selfId, props.blocked);
  const person = (id: string): ChatPerson => {
    const member = dm.members.find((item) => item.id === id);
    return member ? { label: member.label, avatarId: member.avatarId } : props.fallback(id);
  };
  const free = DM_GROUP_MAX - dm.members.length;
  const outside = props.candidates.filter((candidate) => !dm.members.some((member) => member.id === candidate.id));

  useEffect(() => {
    setPeople(false);
    setAdding(false);
    setLeaving(false);
    setNaming(null);
  }, [dm.id]);

  const actions = peer ? (
    <Button appearance="subtle" className={iBlocked ? undefined : "danger-text"} onClick={() => props.onBlock(peer.id, !iBlocked)}>
      {iBlocked ? "Desbloquear" : "Bloquear"}
    </Button>
  ) : (
    <IconAction label="Pessoas do grupo" expanded={people} icon={<PeopleAddRegular />} onClick={() => setPeople((held) => !held)} />
  );

  const banner = (
    <>
      <p className="dm-notice" role="note">
        {DM_NOTICE}
      </p>
      {people && dm.kind === "group" ? (
        <section className="dm-people" aria-label="Pessoas do grupo">
          <ul>
            {dm.members.map((member) => (
              <li key={member.id}>
                <span className="member-avatar" aria-hidden="true">
                  <Face origin={props.origin} imageId={member.avatarId} label={member.label} />
                </span>
                <span>{member.label}</span>
                {member.id === dm.createdBy ? <span className="badge">criou</span> : null}
              </li>
            ))}
          </ul>
          {creator && naming !== null ? (
            <form
              className="row"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                void model.renameDm(dm.id, naming.trim()).then((renamed) => {
                  if (renamed === null) return;
                  props.onChanged(renamed);
                  setNaming(null);
                });
              }}
            >
              <Input aria-label="Nome do grupo" value={naming} maxLength={80} onChange={(_, data) => setNaming(data.value)} autoFocus />
              <Button type="submit" appearance="primary">
                Salvar
              </Button>
              <Button appearance="subtle" onClick={() => setNaming(null)}>
                Cancelar
              </Button>
            </form>
          ) : null}
          {adding ? (
            <PeoplePicker
              title="Adicionar ao grupo"
              submit="Adicionar"
              candidates={outside}
              room={free}
              withName={false}
              onCancel={() => setAdding(false)}
              onSubmit={(ids) => {
                void (async () => {
                  let last: DmSummary | null = null;
                  for (const id of ids) last = (await model.addDmMember(dm.id, id)) ?? last;
                  if (last !== null) props.onChanged(last);
                  setAdding(false);
                })();
              }}
            />
          ) : null}
          {leaving ? (
            <div className="inline-form" role="alertdialog" aria-label="Sair do grupo">
              <p>Sair de {title}? Você deixa de ver as mensagens; quem criou o grupo pode chamar você de volta.</p>
              <div className="row">
                <Button
                  appearance="primary"
                  className="danger"
                  onClick={() =>
                    void model.leaveDm(dm.id).then((left) => {
                      if (left) props.onLeft();
                    })
                  }
                >
                  Sair do grupo
                </Button>
                <Button appearance="subtle" onClick={() => setLeaving(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <div className="row">
              {creator && free > 0 ? (
                <Button appearance="subtle" onClick={() => setAdding(true)}>
                  Adicionar pessoa
                </Button>
              ) : null}
              {creator ? (
                <Button appearance="subtle" onClick={() => setNaming(dm.name ?? "")}>
                  Renomear
                </Button>
              ) : null}
              <Button appearance="subtle" className="danger-text" onClick={() => setLeaving(true)}>
                Sair do grupo
              </Button>
            </div>
          )}
        </section>
      ) : null}
    </>
  );

  return (
    <TextRoom
      model={model}
      chat={{ kind: "dm", id: dm.id, name: title, closed, canPin: true }}
      origin={props.origin}
      userId={selfId}
      manager={false}
      person={person}
      members={dm.members.map((member) => ({ id: member.id, label: member.label, globalName: member.label }))}
      subscribe={props.subscribe}
      onClose={props.onClose}
      actions={
        <>
          {props.notify}
          {actions}
        </>
      }
      banner={banner}
    />
  );
}
