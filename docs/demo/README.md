# The README's pictures

[preview.png](../../preview.png) and [docs/media/stack.png](../media/stack.png) are the real mod in
the real Herdr app, on the showcase stage (`~/workspace/herdr/herdr-showcase`): a second Herdr
app with its own home and herdr-cores, every one of Jeff's mods installed, his layout, and a
made-up world around them (Sam at Acme, the spaces `shop`, `api`, `web`, `docs` and `search`, a
Mac Studio called `studio`, pull requests, servers, a VPN). Nothing in them is Jeff's: the
agents are stand-ins that draw Claude Code's and Codex's screens and report their state as
those agents do, so Herdr posts its own notifications and this mod stacks them.

**The scene** is the stage's default one (space `shop`, Claude Code on "Speed up the checkout
page") with [showcase.sh](showcase.sh) run after it. It leaves four toasts in the stack, so
three show and the oldest folds under "1 more":

1. "Acme EU connected", from the VPN switch after a press off and on: the one folded away.
2. "Fix the flaky checkout test · Finished in 4m 12s · shop".
3. "Rotate the API signing keys · Needs permission · api".
4. "Write the upgrade guide · Has a question · web", from [question.py](question.py): a Claude
   Code stand-in that asks a question (the stage's own agents only ask for permission).

The cast's two toasts are already in the stack when the hook starts. It replays their agents
(`kill -USR1`): each goes back to work, which takes its toast away, and brings the same news
again a few seconds later, after the VPN's. The stage's window is in the background all the
while, where the toasts' clocks don't run.

The pointer is kept off the window for the picture, so the stack isn't hovered: hovered, it
would unfold all four.

`preview.png` has the rest of the window dimmed around the stack (to 0.45 brightness, as the
kit's `shoot.sh --dim` does), so the stack is plainly the subject; `docs/media/stack.png` is the
stack cut out of the same picture, not dimmed.

## Take them again

```sh
sh docs/demo/showcase-shots.sh
```

[showcase-shots.sh](showcase-shots.sh) builds a stage (`~/workspace/herdr/herdr-showcase/stage.sh`
with `SHOWCASE_HOOK` set to showcase.sh), takes one picture with the kit's `shoot.sh`, makes
both files from it and takes the stage down. The stack's place comes from the app's status
(`floats.agent-toasts.bounds`) right after the picture. Given a stage folder built with that
hook, it uses that one and leaves it up.

`shoot.sh` waits until the keyboard and mouse have been still for a minute and takes turns with
other stages, then brings the stage's window to the front for about a second and a half. The
wait can be long; the toasts stay meanwhile, only the VPN's uptime and the agents' clocks move
on. The toasts' clocks run only then, and start again from full each
time the window goes back, so the done toast (8 s) is in every picture.

The kit's own README (`herdr-showcase/README.md`) explains the stage, its stand-ins and its
quirks.
