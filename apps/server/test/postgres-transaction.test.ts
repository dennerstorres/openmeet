import assert from "node:assert/strict";
import test from "node:test";
import { postgresClient } from "../src/db/postgres.js";

test("transaction keeps queries on the reserved connection", async () => {
  const calls: string[] = [];
  const tx: {
    unsafe(statement: string): Promise<unknown[]>;
    savepoint(run: (sx: { unsafe(statement: string): Promise<unknown[]> }) => Promise<unknown>): Promise<unknown>;
  } = {
    async unsafe(statement: string) {
      calls.push(statement);
      return [];
    },
    async savepoint(run) {
      calls.push("savepoint");
      return run(tx);
    },
  };
  const sql = {
    async unsafe(statement: string) {
      calls.push("pool:" + statement);
      return [];
    },
    async begin(run: (reserved: typeof tx) => Promise<unknown>) {
      calls.push("begin");
      return run(tx);
    },
  };

  const client = postgresClient(sql as never);
  const value = await client.transaction(async (db) => {
    await db.query("select 1");
    return "ok";
  });

  assert.equal(value, "ok");
  assert.deepEqual(calls, ["begin", "select 1"]);
});
