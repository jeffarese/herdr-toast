#!/usr/bin/env python3
"""A Claude Code stand-in that works for a while and then asks a question, for the showcase
stage (showcase.sh). The stage's own `claude` (herdr-showcase/bin/agent) only asks for
permission; this one reports `kind=question`, so the toast says "Has a question".

    question.py "task" "question" <seconds before it asks>

It draws Claude Code's screen with the stage's screens (lib/screens.py), then becomes the
stage's agent player under the name `claude`, as the stage's agents do.
"""
import base64
import os
import sys

stage = os.environ["DEMO_WORK"]
sys.path.insert(0, os.path.join(stage, "lib"))
import screens as s  # noqa: E402

task, ask, after = sys.argv[1], sys.argv[2], float(sys.argv[3])
home = os.environ.get("HOME", "")
cwd = os.getcwd()
folder = "~" + cwd[len(home):] if home and cwd.startswith(home) else cwd

head = s.claude_header("Opus 5.5", folder) + s.you(task)
work = (
    s.read("CHANGELOG.md", 214)
    + s.read("docs/upgrading.md", 96)
    + s.say("The 2.4 changes that need a step from users are the new session cookie and the",
            "renamed billing settings. Before I write it up:")
)
rule = f"{s.FAINT}{{RULE}}{s.R}"
dialog = [
    "", rule,
    f" {s.BLUE}☐ Upgrade path{s.R}",
    "",
    f" {s.B}{ask}{s.R}",
    "",
    f" {s.CLAUDE}❯ 1. Yes, from 2.2 and 2.3{s.R}",
    f"      {s.GREY}A section for each, with the cookie step in both.{s.R}",
    "   2. Only from 2.3",
    f"      {s.GREY}2.2 is out of support since March.{s.R}",
    "   3. Type something.",
    "",
    f" {s.GREY}Enter to select · ↑/↓ to navigate · Esc to cancel{s.R}",
]
frames = [
    dict(at=0, state="working", body=head + work[:-3] + s.spinner("Reading the changes"), foot=s.claude_box(s.ACCEPT), clock=40),
    dict(at=after, state="blocked", body=head + work, foot=dialog, clock=0),
]


def b64(text):
    return base64.b64encode(text.encode()).decode()


def osc(state):
    pairs = [f"state={state}", "app=claude", f"title={b64(task)}"]
    if state == "blocked":
        pairs += ["kind=question", f"msg={b64(ask)}"]
    return ":".join(pairs)


run = os.path.join(stage, "run", "agents")
os.makedirs(run, exist_ok=True)
script = os.path.join(run, f"{os.getpid()}.txt")
with open(script, "w") as f:
    for fr in frames:
        glyph = "✋" if fr["state"] == "blocked" else "✳"
        f.write(f"@frame {fr['at']}\n@osc {osc(fr['state'])}\n@title {glyph} {task}\n")
        f.write(f"@clock {fr['clock']}\n@anchor top\n@body\n")
        f.write("\n".join(fr["body"]) + "\n@foot\n" + "\n".join(fr["foot"]) + "\n")

env = dict(os.environ, SC_SCRIPT=script, SC_CPU="0.03")
player = os.path.join(stage, "opt", "claude", "claude")
os.execve(player, ["claude"], env)
