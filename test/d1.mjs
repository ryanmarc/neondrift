// A D1-shaped binding over node:sqlite for tests: the worker's real SQL runs
// against the real schema.sql in memory. Only what db.js uses is mirrored —
// prepare().bind().first() / .run() / .all() — with D1's return shapes.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8"));
  return {
    prepare(sql) {
      const st = db.prepare(sql);
      let args = [];
      const api = {
        bind(...a) { args = a; return api; },
        async first() { return st.get(...args) ?? null; },
        async run() { const r = st.run(...args); return { meta: { changes: r.changes } }; },
        async all() { return { results: st.all(...args) }; },
      };
      return api;
    },
  };
}
