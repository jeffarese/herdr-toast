import test from "node:test";
import assert from "node:assert/strict";
import * as m from "../mods/agent-toast/model.js";

const DONE = `❯ make the reddit sync work on my phone

⏺ Bash(adb devices)
  ⎿ List of devices attached

⏺ Sync now runs on the phone every 15 minutes over Wi-Fi.
  I also added a retry when the token expires.

  - a list item that is not the summary

✻ Churned for 4m 12s · done 9:41 AM

─────────────────────────────────────────
❯
─────────────────────────────────────────
  Jeff │ mbp │ Opus
  ⏵⏵ auto mode on (shift+tab to cycle)`;

test("agent toasts are recognised by their go-to action", () => {
  assert.equal(m.agentTarget({ action: { name: "agent.focus", args: { terminal: "t3" } } }), "t3");
  assert.equal(m.agentTarget({ action: { name: "agent.focus", args: { terminal: "vps/t3" } } }), "vps/t3");
  assert.equal(m.agentTarget({ action: { name: "app.help" } }), null);
  assert.equal(m.agentTarget({ title: "Layout saved" }), null);
});

test("the toast's words decide its kind before the live status catches up", () => {
  assert.equal(m.kindOf({ title: "Claude Code finished" }, "working"), "done");
  assert.equal(m.kindOf({ title: "Claude Code needs you", level: "error" }, "working"), "blocked");
  assert.equal(m.kindOf({ title: "Pi hit an error" }, "working"), "error");
  assert.equal(m.kindOf({ title: "Something" }, "blocked"), "blocked");
  assert.equal(m.statusWord("blocked", "permission"), "Needs permission");
  assert.equal(m.statusWord("blocked", "question"), "Has a question");
  assert.equal(m.statusWord("blocked", null), "Needs you");
  assert.equal(m.statusWord("done"), "Finished");
});

test("titles follow the Agents panel: a named tab, else the agent's own title, else the program", () => {
  const program = { name: "Claude Code", key: "claude" };
  const agent = { title: "✳ Reddit sync on Android phone", program, address: "t1", space_name: "chief" };
  assert.equal(m.agentTitle(agent, { name: "2", named: false }), "Reddit sync on Android phone");
  assert.equal(m.agentTitle(agent, { name: "release", named: true }), "release");
  assert.equal(m.agentTitle({ ...agent, title: "~/workspace/chief" }, { name: "2", named: false }), "Claude Code");
  assert.equal(m.agentTitle({ ...agent, title: "jeff@mbp: ~" }, null), "Claude Code");
});

test("where: the space, a named tab and a remote machine", () => {
  const agent = { address: "t1", space_name: "chief" };
  assert.equal(m.whereOf(agent, { name: "2", named: false }, "Task"), "chief");
  assert.equal(m.whereOf(agent, { name: "api", named: true }, "Task"), "chief · api");
  assert.equal(m.whereOf({ ...agent, address: "vps/t7" }, null, "Task"), "chief · vps");
  assert.equal(m.whereOf(null, null, "Task", "chief / 2"), "chief / 2");
});

test("done preview: the first paragraph of the last message, and the turn's length", () => {
  assert.equal(m.donePreview(DONE), "Sync now runs on the phone every 15 minutes over Wi-Fi. I also added a retry when the token expires.");
  assert.equal(m.turnLength(DONE), "4m 12s");
  assert.equal(m.turnLength("✻ Cooked for 10s · done 6:39 AM"), "10s");
  assert.equal(m.turnLength("✻ Worked for 1h 2m 3s"), "1h 2m 3s");
});

test("done preview prefers a recap written after the last turn, and ignores an older one", () => {
  const rule = DONE.indexOf("─");
  const recap = `${DONE.slice(0, rule)}※ recap: The sync works; next, check it overnight.\n  Then tidy the logs. (disable recaps in /config)\n${DONE.slice(rule)}`;
  assert.equal(m.donePreview(recap), "The sync works; next, check it overnight. Then tidy the logs.");
  const old = `※ recap: an old summary\n\n❯ next task\n\n⏺ The new answer.\n\n✻ Baked for 3s\n\n${"─".repeat(30)}\n❯ \n${"─".repeat(30)}`;
  assert.equal(m.donePreview(old), "The new answer.");
});

test("done preview skips tool calls and housekeeping, and stops at the person's message", () => {
  const s = `⏺ Earlier answer.\n\n❯ do it\n\n⏺ Read(file.txt)\n⏺ Compacted while idle\n\n✻ Mulled for 2s`;
  assert.equal(m.donePreview(s), null);
  assert.equal(m.donePreview(""), null);
});

test("blocked preview names a permission request's tool and command", () => {
  const boxed = `⏺ I will remove the caches.
╭──────────────────────────────────────╮
│ Bash command                         │
│                                      │
│   rm -rf ~/Library/Caches/old        │
│   Remove stale build caches          │
│                                      │
│ Do you want to proceed?              │
│ ❯ 1. Yes                             │
│   2. No (esc)                        │
╰──────────────────────────────────────╯`;
  assert.equal(m.blockedPreview(boxed), "Bash · rm -rf ~/Library/Caches/old");
  const bare = `${"─".repeat(40)}\n Edit file\n src/app.ts\n Do you want to make this edit to app.ts?\n ❯ 1. Yes\n   2. No`;
  assert.equal(m.blockedPreview(bare), "Edit file · src/app.ts");
});

test("blocked preview shows a question as asked", () => {
  const ask = `⏺ A choice first.\n\n☐ Approach\n\nWhich storage should the cache use?\n\n❯ 1. SQLite\n  2. Files\n`;
  assert.equal(m.blockedPreview(ask), "Which storage should the cache use?");
  assert.equal(m.previewOf("blocked", "nothing here"), null);
});

test("the login hint is kept from Herdr's own toast", () => {
  assert.deepEqual(m.loginHint("vps needs login; run hc machine login vps"), { machine: "vps", command: "hc machine login vps" });
  assert.equal(m.loginHint("vps needs login; run hc machine login other"), null);
});
