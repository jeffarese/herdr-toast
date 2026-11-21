// The stack's rules, with the clock passed in.
import test from "node:test";
import assert from "node:assert/strict";
import { Stack, LIMIT, EXIT_MS } from "../mods/agent-toast/store.js";
import { timeoutFor, rowHeight, staleNews, ROW } from "../mods/agent-toast/model.js";

const plain = (title, total = 6000) => ({ title, body: "", level: "info", terminal: null, total });
const agent = (terminal, kind = "done", total = 8000) => ({ title: "Claude Code finished", body: "", terminal, kind, total });

test("a toast leaves when its clock runs out, and is removed once it has folded away", () => {
  const s = new Stack();
  const toast = s.add(plain("Saved"), 0);
  assert.equal(s.tick(5900, false), false);
  assert.equal(toast.leaving, null);
  assert.equal(s.tick(6100, false), true);
  assert.equal(toast.leaving, 6100);
  assert.equal(s.toasts.length, 1); // still drawn, folding away
  assert.equal(s.tick(6100 + EXIT_MS, false), true);
  assert.equal(s.toasts.length, 0);
});

test("while paused every clock goes back to its start, and runs again afterwards", () => {
  const s = new Stack();
  const toast = s.add(plain("Saved"), 0);
  s.tick(4000, false);
  assert.equal(toast.left, 2000);
  s.tick(9000, true); // hovered well past its time
  assert.equal(toast.left, 6000);
  assert.equal(toast.leaving, null);
  s.tick(14000, false);
  assert.equal(toast.left, 1000);
  s.tick(15100, false);
  assert.equal(toast.leaving, 15100);
});

test("a toast with no clock stays until it is dismissed", () => {
  const s = new Stack();
  const toast = s.add(agent("t1", "blocked", null), 0);
  s.tick(10 * 60 * 1000, false);
  assert.equal(toast.leaving, null);
  assert.equal(s.dismiss(toast.id, 1), true);
  assert.equal(s.dismiss(toast.id, 2), false);
});

test("news about the same agent renews its row; the same plain words don't stack either", () => {
  const s = new Stack();
  const first = s.add(agent("t1"), 0);
  first.preview = "old words";
  s.tick(5000, false);
  const again = s.add(agent("t1", "blocked", null), 5000);
  assert.equal(again, first);
  assert.equal(s.toasts.length, 1);
  assert.deepEqual([again.kind, again.rev, again.step, again.preview, again.left], ["blocked", 1, 0, null, null]);
  s.add(agent("t2"), 5000);
  s.add(plain("Copied"), 5000);
  s.add(plain("Copied"), 5200);
  assert.equal(s.toasts.length, 3);
});

test("past the limit the oldest leaves to make room", () => {
  const s = new Stack();
  for (let i = 0; i < LIMIT + 2; i++) s.add(plain(`n${i}`), i);
  assert.equal(s.toasts.filter((x) => !x.leaving).length, LIMIT);
  assert.deepEqual(s.toasts.filter((x) => x.leaving).map((x) => x.title), ["n0", "n1"]);
});

test("a stack counts as drawing only while its timer keeps ticking", () => {
  const s = new Stack();
  assert.equal(s.alive(50000), false);
  s.tick(50000, false);
  assert.equal(s.alive(50500), true);
  assert.equal(s.alive(53000), false);
});

test("wake resolves everyone waiting for a change", async () => {
  const s = new Stack();
  const waits = [s.changed(), s.changed()];
  s.wake();
  await Promise.all(waits);
});

test("how long each kind of toast stays", () => {
  assert.equal(timeoutFor({ timeout: 2500, level: "error" }, false), 2500);
  assert.equal(timeoutFor({ terminal: "t1", kind: "done" }, true), 8000);
  assert.equal(timeoutFor({ terminal: "t1", kind: "blocked" }, true), null); // until answered
  assert.equal(timeoutFor({ terminal: "t1", kind: "blocked" }, false), 15000); // Herdr doesn't list it
  assert.equal(timeoutFor({ level: "error" }, false), 10000);
  assert.equal(timeoutFor({ level: "info" }, false), 6000);
  assert.equal(timeoutFor({ body: "vps needs login; run hc machine login vps" }, false), 15000);
});

test("a row is as tall as the lines it shows", () => {
  assert.equal(rowHeight({ terminal: "t1", preview: null }), ROW.two);
  assert.equal(rowHeight({ terminal: "t1", preview: "All done." }), ROW.three);
  assert.equal(rowHeight({ title: "Copied" }), ROW.one);
  assert.equal(rowHeight({ body: "Short." }), ROW.two);
  assert.equal(rowHeight({ body: "x".repeat(80) }), ROW.three);
});

test("a toast with no clock goes if its agent never shows the news, or is gone", () => {
  const sticky = { kind: "blocked", total: null, armed: false, born: 0 };
  assert.equal(staleNews(sticky, { status: "working" }, 1000), false); // the model may lag
  assert.equal(staleNews(sticky, { status: "working" }, 5000), true);
  assert.equal(staleNews({ ...sticky }, null, 0), true);
  const shown = { kind: "blocked", total: null, armed: false, born: 0 };
  assert.equal(staleNews(shown, { status: "blocked" }, 60000), false);
  assert.equal(staleNews(shown, { status: "working" }, 60001), true);
  const timed = { kind: "done", total: 8000, armed: false, born: 0 };
  assert.equal(staleNews(timed, { status: "working" }, 7000), false); // its clock will take it
});
