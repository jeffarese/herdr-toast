// Exercise the real view code with an in-memory GPUI builder. This does not replace native QA.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as model from "../mods/agent-toast/model.js";
import * as store from "../mods/agent-toast/store.js";

const SCREEN = "⏺ All three runs passed.\n\n✻ Baked for 42s · done 9:00 AM\n";

function world(live = {}) {
  return {
    stack: new store.Stack(), // shared by every copy, as the module's own is
    commands: [],
    closed: [],
    clipboard: [],
    place: { edge: "bottom", align: "end", vertical: false, hovered: false, dragging: false },
    active: true,
    agents: [{ address: "t9", status: "working", focused: false, title: "✳ Reddit sync on Android phone", tab: "tb1", space_name: "chief",
      program: { name: "Claude Code", key: "claude", icon: "icons/claude.svg", tint: false }, ...live }],
    terminals: [{ address: "t9", status: { app: "claude-code", state: "done" } }],
    spaces: [{ tabs: [{ id: "tb1", name: "2", named: false }] }],
  };
}

// One copy of the mod: the stack (props {role: "stack"}) or a notification's own toast.
function open(w, given) {
  const el = (...made) => {
    const data = { nodes: [], props: {}, made };
    let proxy;
    proxy = new Proxy(data, { get(target, key) {
      if (key in target) return target[key];
      return (...args) => {
        if (key === "child") data.nodes.push(args[0]);
        else if (key === "children") data.nodes.push(...args[0]);
        else if (key === "when") { if (args[0]) args[1](proxy); }
        else data.props[key] = args.length === 1 ? args[0] : args;
        return proxy;
      };
    } });
    return proxy;
  };
  const timers = [];
  const cx = {
    notified: 0,
    notify() { this.notified++; }, stop_propagation() { this.stopped = true; },
    spawn(fn) { fn(cx); }, sleep: async () => {}, write_to_clipboard(text) { w.clipboard.push(text); },
    timer: { every: (_ms, fn) => timers.push(fn) },
  };
  const isStack = given.role === "stack";
  const imports = {
    View: class {}, div: el, svg: el, image: el, h_flex: el, v_flex: el,
    props: () => (isStack ? given : { overlay: "o1", ...given }), closeOverlay: (id) => w.closed.push(id),
    run: (name, args) => w.commands.push({ name, args }), theme: () => new Proxy({}, { get: (_t, k) => (k === "blocked" ? "#e06c75" : "#aabbcc") }),
    agents: () => w.agents, terminals: () => w.terminals, spaces: () => w.spaces,
    hc: async () => ({ code: 0, stdout: SCREEN, stderr: "" }),
    settings: () => ({ zoom: 1 }), layout: () => w.layout, panes: () => [], shared: k => w[k],
    setShared: (k, v) => { w[k] = v; }, window: () => ({ platform: "macos" }),
    placement: () => (isStack ? w.place : null), checking: () => false, appWindow: () => ({ active: w.active }),
    ...model, ...store, stack: w.stack,
  };
  const railSource = readFileSync(new URL("../mods/agent-toast/sidebar-rail.js", import.meta.url), "utf8")
    .replace(/^import .*;$/gm, "").replaceAll("export function ", "function ");
  Object.assign(imports, new Function(...Object.keys(imports), railSource + "\nreturn { currentSidebar, sidebarButton };")(...Object.values(imports)));
  const source = readFileSync(new URL("../mods/agent-toast/main.js", import.meta.url), "utf8")
    .replace(/^import [\s\S]*?;$/gm, "").replace("export default class", "return class");
  const View = new Function(...Object.keys(imports), source)(...Object.values(imports));
  const view = new View();
  view.init({}, cx);
  return { view, cx, tick: () => timers.forEach((fn) => fn(cx)), render: () => view.render(cx) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const text = (node) => (typeof node === "string" ? node : node?.nodes ? node.nodes.map(text).join(" ") : "");
function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.props?.id === id) return node;
  for (const child of node.nodes ?? []) { const match = find(child, id); if (match) return match; }
  return null;
}

const FINISHED = { title: "Claude Code finished", body: "chief / 2", level: "info", action: { name: "agent.focus", args: { terminal: "t9" } } };
const STACK = { role: "stack" };

// A stack and one notification handed to it; `toast` is its row in the stack.
async function shown(given, live) {
  const w = world(live);
  const stackCopy = open(w, STACK);
  const copy = open(w, given);
  stackCopy.tick(); // the stack's own timer reads the agent's last words
  await settle();
  return { w, stack: stackCopy, copy, toast: w.stack.toasts[0] };
}

test("a notification hands itself to the stack and closes its own overlay", async () => {
  const h = await shown(FINISHED);
  assert.deepEqual(h.w.closed, ["o1"]);
  assert.equal(text(h.copy.render()), "");
  assert.equal(h.w.stack.toasts.length, 1);
  assert.ok(h.stack.cx.notified > 0); // the stack was woken to draw it
});

test("an agent toast shows the task, its state, where, the turn's length and its last words", async () => {
  const h = await shown(FINISHED);
  const said = text(h.stack.render());
  assert.match(said, /Reddit sync on Android phone/);
  assert.match(said, /Finished in 42s/);
  assert.match(said, /chief/);
  assert.match(said, /All three runs passed\./);
  assert.doesNotMatch(said, /Claude Code finished/);
});

test("a row is drawn folded, then at its size a frame later", async () => {
  const h = await shown(FINISHED);
  h.toast.step = 0; h.toast.entered = false; // as it arrives
  let row = find(h.stack.render(), `row-${h.toast.id}`);
  assert.deepEqual([row.props.h, row.props.opacity], [0, 0]);
  row = find(h.stack.render(), `row-${h.toast.id}`);
  assert.deepEqual([row.props.h, row.props.opacity], [model.ROW.three, 1]);
});

test("clicking goes to the agent and the row leaves; × leaves without going", async () => {
  let h = await shown(FINISHED);
  find(h.stack.render(), `toast-${h.toast.id}`).props.on_click({}, h.stack.cx);
  assert.deepEqual(h.w.commands, [{ name: "agent.focus", args: { terminal: "t9" } }]);
  assert.ok(h.toast.leaving);
  assert.equal(find(h.stack.render(), `row-${h.toast.id}`).props.h, 0);

  h = await shown(FINISHED);
  find(h.stack.render(), `dismiss-${h.toast.id}`).props.on_click({}, h.stack.cx);
  assert.equal(h.stack.cx.stopped, true);
  assert.deepEqual(h.w.commands, []);
  assert.ok(h.toast.leaving);
});

test("the toast stays while the model lags, then leaves once the news is stale", async () => {
  const h = await shown(FINISHED);
  h.stack.render(); // still "working" in the model: not stale
  assert.equal(h.toast.leaving, null);
  h.w.agents[0].status = "done";
  h.stack.render();
  assert.equal(h.toast.leaving, null);
  h.w.agents[0].status = "idle"; // someone looked at it
  h.stack.render();
  assert.ok(h.toast.leaving);
});

test("a blocked toast says what kind of help is needed, and has no clock", async () => {
  const blocked = { ...FINISHED, title: "Claude Code needs you", level: "error" };
  let h = await shown(blocked, { status: "blocked" });
  assert.match(text(h.stack.render()), /Needs you/);
  assert.equal(h.toast.total, null);
  assert.equal(find(h.stack.render(), `clock-${h.toast.id}-0`), null);

  const w = world({ status: "blocked" });
  w.terminals[0].status = { app: "claude-code", state: "blocked", kind: "permission" };
  const stackCopy = open(w, STACK);
  open(w, blocked);
  assert.match(text(stackCopy.render()), /Needs permission/);
});

test("the clock line runs out over the time left, and goes back to full while the pointer is on the stack", async () => {
  const h = await shown({ title: "Layout saved", body: "agents-first is now your default layout.", level: "success" });
  h.stack.render(); // drawn at its start
  let line = find(h.stack.render(), `clock-${h.toast.id}-0`);
  assert.equal(line.props.w, 0);
  assert.equal(line.props.transition[1].duration, 6000);
  h.toast.left = 1200;
  h.w.place.hovered = true;
  h.stack.tick();
  assert.equal(h.toast.left, 6000);
  line = find(h.stack.render(), `clock-${h.toast.id}-0`);
  assert.ok(line.props.w > 300);
  h.w.place.hovered = false;
  h.w.active = false; // nobody at the window: the clocks wait too
  h.toast.left = 1200;
  h.stack.tick();
  assert.equal(h.toast.left, 6000);
});

test("past three, older toasts fold under a count until the stack is hovered; Clear all empties it", async () => {
  const w = world();
  const stackCopy = open(w, STACK);
  for (const title of ["one", "two", "three", "four", "five"]) open(w, { title, level: "info" });
  stackCopy.render();
  let root = stackCopy.render();
  const heights = () => w.stack.toasts.map((toast) => find(root, `row-${toast.id}`).props.h);
  assert.deepEqual(heights(), [0, 0, model.ROW.one, model.ROW.one, model.ROW.one]);
  assert.match(text(find(root, "toasts-more")), /2 more/);
  assert.match(text(root), /three .*four .*five/); // newest next to the bottom edge

  w.place.hovered = true;
  root = stackCopy.render();
  assert.deepEqual(heights(), Array(5).fill(model.ROW.one));
  assert.match(text(find(root, "toasts-more")), /5 notifications/);

  w.place = { ...w.place, edge: "top" }; // anchored at the top: newest next to that edge
  assert.match(text(stackCopy.render()), /five .*four .*three/);

  find(root, "toasts-clear").props.on_click({}, stackCopy.cx);
  assert.ok(w.stack.toasts.every((toast) => toast.leaving));
});

test("with nothing to say the stack draws nothing, so its float hides", () => {
  const w = world();
  assert.equal(text(open(w, STACK).render()), "");
});

test("plain notifications keep title and body, and the login hint keeps Copy", async () => {
  let h = await shown({ title: "Layout saved", body: "agents-first is now your default layout.", level: "success" });
  assert.match(text(h.stack.render()), /Layout saved .*agents-first/);

  h = await shown({ title: "vps needs login", body: "vps needs login; run hc machine login vps", level: "warning" });
  const root = h.stack.render();
  assert.match(text(root), /vps needs a login/);
  find(root, `copy-${h.toast.id}`).props.on_click({}, h.stack.cx);
  assert.deepEqual(h.w.clipboard, ["hc machine login vps"]);
  assert.equal(h.toast.leaving, null);
  assert.match(text(h.stack.render()), /Copied/);
});

test("without a stack in the layout the toast draws itself in Herdr's overlay", async () => {
  const w = world();
  const copy = open(w, FINISHED);
  await settle();
  assert.deepEqual(w.closed, []);
  const root = copy.render();
  assert.match(text(root), /Reddit sync on Android phone .*Finished in 42s .*All three runs passed\./);
  find(root, `toast-${copy.view.solo.id}`).props.on_click({}, copy.cx);
  assert.deepEqual(w.commands, [{ name: "agent.focus", args: { terminal: "t9" } }]);
  assert.deepEqual(w.closed, ["o1"]);

  const stale = open(world({ status: "done" }), FINISHED);
  stale.render();
});

test("a stack that closed hands notifications back to Herdr's overlay", async () => {
  const w = world();
  const stackCopy = open(w, STACK);
  await stackCopy.view.close();
  const copy = open(w, FINISHED);
  assert.deepEqual(w.closed, []);
  assert.match(text(copy.render()), /Reddit sync/);
});


test("a docked stack stays reachable when empty and its rail icon opens the notification", async () => {
  const w = world();
  w.place = null;
  w.layout = { type: "row", children: [
    { content: { tab: "active" } },
    { id: "sidebar-right", size: { px: 52 }, content: { mod: "agent-toast", props: STACK } },
  ] };
  const dock = open(w, STACK);
  assert.ok(find(dock.render(), "expand"));
  assert.ok(find(dock.render(), "no-toasts"));
  open(w, FINISHED);
  await settle();
  const toast = w.stack.toasts[0];
  const icon = find(dock.render(), `toast-${toast.id}`);
  assert.match(icon.props.tooltip, /Claude Code finished/);
  icon.props.on_click(null, dock.cx);
  assert.deepEqual(w.commands.at(-1), FINISHED.action);
});
