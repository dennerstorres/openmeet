import assert from "node:assert/strict";
import test from "node:test";
import { createChatFeed, createSseParser, createWebTransport } from "../src/meeting/chat-events.ts";

const origin = "https://meet.example.com";

function fakeTransport() {
  const opens = [];
  return {
    opens,
    open(lastEventId, event, closed) {
      const connection = { lastEventId, event, closed, stopped: false };
      opens.push(connection);
      return () => {
        connection.stopped = true;
      };
    },
  };
}

function manualClock() {
  const timers = [];
  return {
    timers,
    schedule(run, ms) {
      const timer = { run, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    fire() {
      const timer = timers.shift();
      if (timer && !timer.cancelled) timer.run();
      return timer;
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the parser keeps frames split across chunks and skips comments", () => {
  const parse = createSseParser();
  assert.deepEqual(parse("retry: 3000\n\nid: ab-1\nevent: message.cre"), []);
  assert.deepEqual(parse('ated\ndata: {"body":"olá"}\n\n: keepalive\n\nevent: typing\r\ndata: a\r\ndata: b\r\n\r\n'), [
    { id: "ab-1", name: "message.created", data: '{"body":"olá"}' },
    { id: null, name: "typing", data: "a\nb" },
  ]);
  assert.deepEqual(parse("data: sem nome\n\n"), []);
});

test("the feed resumes from the last numbered id and backs off between failures", async () => {
  const transport = fakeTransport();
  const clock = manualClock();
  const seen = [];
  const states = [];
  let resets = 0;
  const feed = createChatFeed(transport, {
    renew: async () => true,
    event: (name, data) => seen.push([name, data]),
    reset: () => (resets += 1),
    state: (state) => states.push(state),
    schedule: clock.schedule,
  });
  const first = transport.opens[0];
  assert.equal(first.lastEventId, undefined);
  first.event({ id: "e-0", name: "ready", data: "{}" });
  first.event({ id: "e-1", name: "message.created", data: '{"id":"1"}' });
  first.event({ id: null, name: "typing", data: '{"userId":"u"}' });
  first.event({ id: "e-2", name: "message.created", data: "not json" });
  assert.deepEqual(seen, [
    ["message.created", { id: "1" }],
    ["typing", { userId: "u" }],
  ]);

  first.closed(0);
  await tick();
  assert.equal(clock.timers[0].ms, 1000);
  clock.fire();
  assert.equal(transport.opens[1].lastEventId, "e-2");
  transport.opens[1].closed(503);
  await tick();
  assert.equal(clock.timers[0].ms, 2000);
  clock.fire();
  transport.opens[2].event({ id: "e-9", name: "reset", data: "{}" });
  assert.equal(resets, 1);
  transport.opens[2].closed(429);
  await tick();
  assert.equal(clock.timers[0].ms, 8000);
  assert.ok(states.includes("live") && states.includes("waiting"));

  feed.close();
  assert.equal(clock.timers[0].cancelled, true);
  assert.equal(transport.opens.length, 3);
});

test("a 401 renews once and reconnects; a second 401 signs the feed out", async () => {
  const transport = fakeTransport();
  const states = [];
  let renewals = 0;
  createChatFeed(transport, {
    renew: async () => {
      renewals += 1;
      return true;
    },
    event: () => undefined,
    reset: () => undefined,
    state: (state) => states.push(state),
    schedule: manualClock().schedule,
  });
  transport.opens[0].closed(401);
  await tick();
  assert.equal(renewals, 1);
  assert.equal(transport.opens.length, 2);
  transport.opens[1].closed(401);
  await tick();
  assert.equal(renewals, 1);
  assert.equal(transport.opens.length, 2);
  assert.equal(states.at(-1), "signed-out");
});

test("events after close and a late second close are ignored", async () => {
  const transport = fakeTransport();
  const seen = [];
  const clock = manualClock();
  const feed = createChatFeed(transport, { renew: async () => true, event: (name) => seen.push(name), reset: () => undefined, schedule: clock.schedule });
  const connection = transport.opens[0];
  connection.closed(0);
  connection.closed(0);
  await tick();
  assert.equal(clock.timers.length, 1);
  feed.close();
  connection.event({ id: "x-1", name: "message.created", data: "{}" });
  assert.deepEqual(seen, []);
  assert.equal(transport.opens[0].stopped, false);
});

function streamResponse(chunks, init = {}) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: init.status ?? 200, headers: { "content-type": init.type ?? "text/event-stream; charset=utf-8" } });
}

test("the web transport sends the web header and Last-Event-ID, and reports the status", async () => {
  const calls = [];
  const transport = createWebTransport(origin, async (url, init) => {
    calls.push({ url, init });
    return calls.length === 1 ? streamResponse(["event: ready\nid: e-0\ndata: {}\n\n", "event: typing\ndata: {}\n\n"]) : new Response("{}", { status: 401 });
  });
  const events = [];
  const status = await new Promise((resolve) => transport.open("e-5", (event) => events.push(event.name), resolve));
  assert.equal(status, 0);
  assert.deepEqual(events, ["ready", "typing"]);
  assert.equal(calls[0].url, `${origin}/api/v1/events`);
  assert.equal(calls[0].init.headers["x-openmeet-web"], "1");
  assert.equal(calls[0].init.headers["last-event-id"], "e-5");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(await new Promise((resolve) => transport.open(undefined, () => undefined, resolve)), 401);
  assert.equal("last-event-id" in calls[1].init.headers, false);
});

test("a 200 that is not an event stream counts as a network failure", async () => {
  const transport = createWebTransport(origin, async () => streamResponse(["<html>"], { type: "text/html" }));
  assert.equal(await new Promise((resolve) => transport.open(undefined, () => undefined, resolve)), 0);
});
