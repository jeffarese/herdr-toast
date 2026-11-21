#!/usr/bin/env python3
"""Install the agent-toast mod and make the shown layout use it for notifications.

A layout uses it in two places: `"toast": "agent-toast"` sends every notification
to the mod, and a floating block (id agent-toasts) is the stack that draws them.
Herdr's own layouts are read-only, so a shipped one (main, terminals, win98) is
cloned first as <name>-toasts and the window switches to the clone. Personal
layouts that already use the mod get the stack too. Run again to update the mod.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

SOURCE = Path(__file__).resolve().parent.parent
APP_HOME = Path(os.environ.get("HERDR_APP_HOME", Path.home() / ".config/herdr-app"))
MOD = "agent-toast"
SHIPPED = {"main", "terminals", "win98"}
STACK = {"id": "agent-toasts", "content": {"mod": MOD, "props": {"role": "stack"}}, "edge": "bottom", "align": "end"}


def app(*args, timeout=60):
    return subprocess.run(["herdr-app", *args], check=True, timeout=timeout, capture_output=True, text=True).stdout


def uses(path):
    try:
        return json.loads(path.read_text()).get("toast") == MOD
    except (OSError, ValueError):
        return False


def use(path):
    """Point a layout's notifications at the mod and give it the stack. True if it changed."""
    tree = json.loads(path.read_text())
    floating = tree.get("floating") or []
    stacked = any(block.get("content", {}).get("mod") == MOD for block in floating if isinstance(block, dict))
    if tree.get("toast") == MOD and stacked:
        return False
    tree["toast"] = MOD
    if not stacked:
        tree["floating"] = [*floating, STACK]
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(tree, indent=2) + "\n")
    tmp.replace(path)
    return True


def install():
    if not shutil.which("herdr-app") or not (APP_HOME / "layouts").is_dir():
        sys.exit("Start Herdr once before installing.")
    app("check", str(SOURCE / "mods" / MOD))
    target = APP_HOME / "mods" / MOD
    staged = target.with_name(f".{MOD}.new")
    shutil.rmtree(staged, ignore_errors=True)
    shutil.copytree(SOURCE / "mods" / MOD, staged, ignore=shutil.ignore_patterns("*.d.ts", "jsconfig.json", "*.error"))
    app("check", str(staged))
    shutil.rmtree(target, ignore_errors=True)
    staged.rename(target)
    print(f"Installed {target}")

    layout = json.loads(app("status", timeout=15))["layout"]
    if layout in SHIPPED:
        clone = f"{layout}-toasts"
        if not (APP_HOME / "layouts" / f"{clone}.json").exists():
            app("do", "layout.clone", json.dumps({"name": layout, "as": clone}), timeout=15)
            time.sleep(1)  # Herdr writes the clone asynchronously.
        else:
            app("do", "layout.switch", "--name", clone, timeout=15)
        layout = clone
    use(APP_HOME / "layouts" / f"{layout}.json")
    print(f"Layout {layout} shows notifications with {MOD}.")
    for path in sorted((APP_HOME / "layouts").glob("*.json")):
        if path.stem != layout and path.stem not in SHIPPED and uses(path) and use(path):
            print(f"Layout {path.stem} got the toast stack too.")
    if layout.endswith("-toasts"):
        print(f"Back to Herdr's layout: herdr-app do layout.switch --name {layout[:-len('-toasts')]}")


if __name__ == "__main__":
    try:
        install()
    except subprocess.CalledProcessError as error:
        sys.exit(f"Installation stopped: {(error.stderr or error.stdout or str(error)).strip()}")
    except (OSError, subprocess.SubprocessError, KeyError, ValueError) as error:
        sys.exit(f"Installation stopped: {error}")
