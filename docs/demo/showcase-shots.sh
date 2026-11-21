#!/bin/sh
# Takes the README's pictures on a showcase stage (herdr-showcase), with the kit's shoot.sh:
#
#   sh docs/demo/showcase-shots.sh          builds a stage with showcase.sh as its hook, takes the
#                                           pictures and takes the stage down
#   sh docs/demo/showcase-shots.sh <stage>  on a stage built with that hook; leaves it up
#
# preview.png             the whole window, the stack in the corner (three toasts and "1 more"),
#                         the rest of the window dimmed
# docs/media/stack.png    the stack alone, cut out of the same picture, not dimmed
#
# One shoot.sh picture makes both. The stack's place is read from the app's status right after
# it (the frame the picture is), and the dim is shoot.sh's own (the rest at 0.45 brightness),
# applied here so that the close-up comes from the same picture undimmed. Each picture waits
# until nobody has touched the keyboard or mouse for a minute and takes turns with other stages,
# so a run can take some minutes.
set -eu
here=$(cd "$(dirname "$0")" && pwd -P)
repo=$(cd "$here/../.." && pwd -P)
kit=${SHOWCASE_KIT:-$HOME/workspace/herdr/herdr-showcase}

if [ $# -gt 0 ]; then
  w=$(cd "$1" && pwd -P)
else
  w=$(SHOWCASE_HOOK="$here/showcase.sh" sh "$kit/stage.sh")
  trap 'sh "$kit/stage.sh" --down "$w"' EXIT
fi
pil=$(for p in /opt/homebrew/bin/python3 /usr/local/bin/python3; do [ -x "$p" ] && "$p" -c 'import PIL' 2>/dev/null && echo "$p" && break; done)
mkdir -p "$repo/docs/media"

sh "$kit/shoot.sh" "$w" "$w/toasts.png" >/dev/null
# The stack's floating block, in points: x, y, width, height.
box=$(. "$w/env.sh" && herdr-app status | /usr/bin/python3 -c 'import json, sys
print(",".join(str(int(v)) for v in json.load(sys.stdin)["floats"]["agent-toasts"]["bounds"]))')
"$pil" - "$w/toasts.png" "$repo/preview.png" "$repo/docs/media/stack.png" "$box" <<'PY'
import sys
from PIL import Image, ImageEnhance
src, preview, stack, box = sys.argv[1:5]
img = Image.open(src).convert("RGB")
x, y, w, h = (int(v) * 2 for v in box.split(","))
m = 16  # the cards' shadow
lit = (max(0, x - m), max(0, y - m), min(img.width, x + w + m), min(img.height, y + h + m))
dark = ImageEnhance.Brightness(img).enhance(0.45)
dark.paste(img.crop(lit), lit[:2])
dark.save(preview, optimize=True)
# The close-up: the stack with some of the window around it.
m = 48
img.crop((max(0, x - m), max(0, y - m), min(img.width, x + w + m), min(img.height, y + h + m))).save(stack, optimize=True)
PY
