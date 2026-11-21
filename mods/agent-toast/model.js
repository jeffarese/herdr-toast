// Pure helpers for the agent toast: what kind of news a notification is, what to
// call the agent, and a one-line preview read from the end of its screen.

// Herdr's own agent toasts read "<Program> finished" / "<Program> needs you" and
// carry action agent.focus {terminal}. Anything else is a plain notification.
export function agentTarget(p) {
  const a = p?.action;
  if (!a || typeof a.args?.terminal !== "string") return null;
  return ["agent.focus", "pane.focus", "terminal.peek", "terminal.show"].includes(a.name) ? a.args.terminal : null;
}

// done | blocked | error, from the toast's words first: the live model can lag
// the notification by a frame, so the agent may still read "working" at first.
export function kindOf(p, live) {
  const title = String(p?.title ?? "");
  if (/needs you\s*$/i.test(title)) return "blocked";
  if (/finished\s*$/i.test(title)) return "done";
  if (/\b(error|failed|crashed)\b/i.test(title)) return "error";
  if (live === "blocked" || live === "done" || live === "error") return live;
  return p?.level === "error" ? "blocked" : "done";
}

const BLOCKED_WORDS = { permission: "Needs permission", question: "Has a question", auth: "Needs a login" };

export function statusWord(kind, reason) {
  if (kind === "blocked") return BLOCKED_WORDS[reason] ?? "Needs you";
  if (kind === "error") return "Hit an error";
  return "Finished";
}

const clean = (s) => String(s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

// The same name Herdr's Agents panel shows: the agent's own title when it says
// something (not a path, a host or the program's name), unless someone named the tab.
export function agentTitle(agent, tab) {
  const prog = agent?.program?.name;
  const raw = agent?.title ?? "";
  const live = clean(raw);
  const path = /^[~/]|^[A-Za-z]:\\/.test(raw.replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== agent?.program?.key;
  if (tab?.named && tab.name !== prog) return tab.name;
  if (telling) return live;
  return prog || "Agent";
}

// "flowie", "flowie · api" (a named tab), "flowie · vps" (another machine).
export function whereOf(agent, tab, title, body) {
  if (!agent) return String(body ?? "");
  const parts = [agent.space_name];
  if (tab?.named && tab.name !== title) parts.push(tab.name);
  const machine = agent.address.includes("/") ? agent.address.split("/")[0] : null;
  if (machine) parts.push(machine);
  return parts.filter(Boolean).join(" · ");
}

const MAX = 240;
const tidy = (s) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const cut = (s) => (s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s);
// Box drawing around dialogs and the input box: "│ text │".
const unbox = (l) => l.replace(/^\s*[│┃║]\s?/, "").replace(/\s*[│┃║]\s*$/, "");
const isRule = (l) => /^\s*[╭╰┌└├]?[─━═]{6,}/.test(l);
// A turn's end: "✻ Churned for 1m 52s · done 2:41 PM", "* Cooked for 10s".
const TURN_END = /^\s*\S\s+\p{Lu}[\p{L}'’-]* for ((?:\d+\s?[hms]\s?){1,3})/u;
const BULLET = /^(?:⏺|●|•)\s+(.*)$/;
// Bullets that aren't the agent speaking: tool calls, housekeeping.
const NOISE = /^(?:\w+\(|Compacted\b|Update installed|Interrupted\b|Read \d+ files?)/;

// How long the last turn took, as the agent printed it ("1m 52s"), or null.
export function turnLength(screen) {
  const lines = String(screen ?? "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = TURN_END.exec(lines[i]);
    if (m) return m[1].trim();
  }
  return null;
}

// The input box (or a dialog) starts at the last run of rules near the bottom.
function contentEnd(lines) {
  let end = lines.length;
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 14); i--) if (isRule(lines[i])) end = i;
  return end;
}

// The agent's last words: a "※ recap:" written after the last turn, else the
// first paragraph of its last message.
export function donePreview(screen) {
  const lines = String(screen ?? "").split("\n");
  const end = contentEnd(lines);
  let turn = -1;
  for (let i = end - 1; i >= 0; i--) if (TURN_END.test(lines[i])) { turn = i; break; }
  for (let i = end - 1; i > turn; i--) {
    const m = /^\s*※\s*recap:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const parts = [m[1]];
    for (let j = i + 1; j < end && /^\s{2,}\S/.test(lines[j]) && !/^\s*⎿/.test(lines[j]); j++) parts.push(lines[j]);
    const text = tidy(parts.join(" ").replace(/\(disable recaps in \/config\)/, ""));
    if (text) return cut(text);
  }
  for (let i = (turn >= 0 ? turn : end) - 1; i >= 0; i--) {
    if (/^❯/.test(lines[i])) break; // the person's message: the turn started here
    const m = BULLET.exec(lines[i]);
    if (!m || NOISE.test(m[1])) continue;
    const parts = [m[1]];
    for (let j = i + 1; j < end && /^\s{2,}\S/.test(lines[j]); j++) parts.push(lines[j]);
    const text = tidy(parts.join(" "));
    if (text) return cut(text);
  }
  return null;
}

// What it's asking: "Bash · rm -rf build" for a permission dialog, else the question.
export function blockedPreview(screen) {
  const lines = String(screen ?? "").split("\n").map(unbox);
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 40); i--) {
    const line = lines[i].trim();
    if (!/\?\s*$/.test(line) || /^(?:❯\s*)?\d+[.)]/.test(line) || /^❯/.test(line)) continue;
    if (/^(?:Do you want|Allow|Proceed)/i.test(line)) {
      let top = i - 1;
      while (top >= 0 && !isRule(lines[top]) && i - top < 16) top--;
      const body = lines.slice(top + 1, i).map((l) => l.trim()).filter(Boolean);
      if (body.length >= 2) return cut(tidy(`${body[0].replace(/\s+command$/i, "")} · ${body[1]}`));
      if (body.length === 1) return cut(tidy(body[0]));
    }
    return cut(tidy(line.replace(/^[?☐□◯○●]\s*/, "")));
  }
  return null;
}

export function previewOf(kind, screen) {
  return kind === "blocked" ? blockedPreview(screen) : donePreview(screen);
}

// Herdr's login hint, kept from the shipped toast: "<m> needs login; run hc machine login <m>".
export function loginHint(body) {
  const m = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(String(body ?? ""));
  return m ? { machine: m[1], command: `hc machine login ${m[1]}` } : null;
}

// Stale news goes by itself: a done turn goes idle when someone looks at the agent,
// a blocked one goes back to work when it's answered. The live model can lag the
// notification, so the news only counts once the agent has shown it (armed). A toast
// with no clock can't wait for that forever: if the agent never shows its news, or is
// gone, the toast goes too.
const ARM_MS = 4000;
export function staleNews(toast, agent, now) {
  const sticky = toast.total == null;
  if (!agent) return toast.armed || sticky;
  if (agent.status === toast.kind) toast.armed = true;
  if (toast.armed) return agent.status !== toast.kind || Boolean(agent.focused);
  return sticky && now - toast.born > ARM_MS;
}

// How long a toast stays, in ms; null: until it's stale or dismissed. A caller's own
// timeout wins. An agent that needs the person stays until it's answered, as long as
// Herdr lists it (so the toast can tell when that happens).
export function timeoutFor(item, known) {
  if (Number.isFinite(item.timeout) && item.timeout > 0) return item.timeout;
  if (item.terminal) {
    if (item.kind === "blocked") return known ? null : 15000;
    return item.kind === "error" ? 12000 : 8000;
  }
  if (loginHint(item.body)) return 15000;
  return { error: 10000, warning: 8000 }[item.level] ?? 6000;
}

// A row's height in px: the lines it will show. Rows animate between fixed heights.
export const ROW = { one: 46, two: 58, three: 76 };
const WRAP = 46; // about how many characters of body fit on one line
export function rowHeight(toast) {
  if (toast.terminal) return toast.preview ? ROW.three : ROW.two;
  if (!toast.body) return ROW.one;
  if (loginHint(toast.body)) return ROW.two;
  return String(toast.body).length > WRAP ? ROW.three : ROW.two;
}
