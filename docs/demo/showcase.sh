#!/bin/sh
# The toast stack's scene on the showcase stage (herdr-showcase), run after its cast:
#
#   w=$(SHOWCASE_HOOK=$PWD/docs/demo/showcase.sh sh ~/workspace/herdr/herdr-showcase/stage.sh)
#
# It leaves four toasts in the stack, so that three show and the oldest folds under "1 more":
#
#   1. "Acme EU connected" (the VPN switch, after a press off and on): folded away
#   2. "Fix the flaky checkout test · Finished in 4m 12s · shop"
#   3. "Rotate the API signing keys · Needs permission · api"
#   4. "Write the upgrade guide · Has a question · web" (question.py, a new tab in web)
#
# The cast's two toasts are already there; replaying their agents (kill -USR1) sends them back
# to work, which takes their toasts away, and brings the same news again 12 and 13 s later, so
# they arrive after the VPN's. The stage's window stays in the background throughout, where
# the toasts' clocks don't run. Shoot within a few minutes: nothing here expires, but the VPN's
# uptime and the agents' clocks move on.
set -eu
w=$(cd "${1:?usage: showcase.sh <stage folder>}" && pwd -P)
# shellcheck disable=SC1091
. "$w/env.sh"
here=$(cd "$(dirname "$0")" && pwd -P)

say() { printf '%s\n' "toast: $*" >&2; }
# The PID of the cast's agent whose terminal title is <task>.
agent_pid() {
  for f in "$w"/run/agents/*.txt; do
    grep -q "^@title .*$1\$" "$f" || continue
    p=$(basename "$f" .txt)
    kill -0 "$p" 2>/dev/null && { echo "$p"; return; }
  done
}

# 1. The VPN off and on again with the switch's own key command: "Acme EU connected".
# SC_VPN_TOGGLE names that command (the VPN switch mod's toggle); without it, no VPN toast.
if [ -n "${SC_VPN_TOGGLE:-}" ]; then
  say "VPN off and on"
  herdr-app do "$SC_VPN_TOGGLE" >/dev/null
  sleep 5
  herdr-app do "$SC_VPN_TOGGLE" >/dev/null
  sleep 8
fi

# 2-4. The agents' news again, in order: done at 12 s, permission at 13 s, the question at 16 s.
say "agents"
flaky=$(agent_pid "Fix the flaky checkout test")
keys=$(agent_pid "Rotate the API signing keys")
[ -n "$flaky" ] && [ -n "$keys" ] || { say "the cast's agents aren't running"; exit 1; }
web=$(herdr-app ls | /usr/bin/python3 -c 'import json, sys
print(next(s["id"] for s in json.load(sys.stdin)["spaces"] if s["name"] == "web"))')
kill -USR1 "$flaky" "$keys"
herdr-app do tab.new --space "$web" --folder "$HOME/code/web" --focus false \
  --argv "[\"/usr/bin/python3\",\"$here/question.py\",\"Write the upgrade guide\",\"Should the guide cover upgrades from 2.2 too?\",\"16\"]" >/dev/null
sleep 20

# The default scene's focus: shop, Claude Code on "Speed up the checkout page".
herdr-app do space.select --index 1 >/dev/null
herdr-app do tab.select --index 1 >/dev/null
say "four toasts: three shown, one under \"1 more\""
