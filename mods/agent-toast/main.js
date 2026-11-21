// Notifications that say which agent and what it did, kept in one stack. Herdr's own
// agent toasts ("Claude Code finished / chief / 2") become the agent's task, its state,
// where it runs and its last words; every other notify() keeps a clean generic look.
//
// The mod runs in two roles. As the layout's floating block (props {role: "stack"}) it
// draws every toast in one panel: rows fold in and out, a thin line counts down, the
// clocks stop while the pointer is on the panel, and past three the older rows fold
// under "N more" until the panel is hovered. As the layout's "toast" mod it is opened
// once per notification: it hands the news to the stack and closes. With no stack in
// the layout it draws the toast itself, in Herdr's own overlay.
//
// Click: go there. ×: dismiss. A toast leaves once its news is stale (you looked at
// the agent, or it went back to work).

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { currentSidebar, sidebarButton } from "./sidebar-rail.js";
import { settings, props, closeOverlay, run, theme, agents, terminals, spaces, hc, placement, checking, window as appWindow } from "herdr";
import { agentTarget, kindOf, statusWord, agentTitle, whereOf, previewOf, turnLength, loginHint, staleNews, timeoutFor, rowHeight } from "./model.js";
import { Stack, stack, SHOWN } from "./store.js";

const ASSETS = "mods/agent-toast";
// Plain notifications: a drawn icon per level (icons/*.png) and its color, for the wash
// and the clock line. The colors are the icons' own, so they match in every theme.
const LEVEL = {
  error: { icon: "error", tone: "#f43f5e" },
  warning: { icon: "warning", tone: "#f59e0b" },
  success: { icon: "success", tone: "#22c55e" },
  info: { icon: "info", tone: "#3b82f6" },
  login: { icon: "login", tone: "#eab308" },
};
const levelOf = (toast) => (loginHint(toast.body) ? LEVEL.login : LEVEL[toast.level] ?? LEVEL.info);
const BADGE = { done: { color: "done", glyph: "check" }, blocked: { color: "blocked", glyph: "alert" }, error: { color: "blocked", glyph: "x" } };

const WIDTH = 380;
const INSET = 5; // around each row's hover highlight
const MORE = 28; // the "N more" bar
const TICK = 200; // how often the clocks are read
const LINGER = 450; // the stack stays unfolded this long after the pointer leaves
const MOVE = { duration: 280, easing: "ease-out" };
const FADE_IN = { duration: 240, delay: 60, easing: "ease-out" };
const FADE_OUT = { duration: 160, easing: "ease-in" };
const WASH = { duration: 1600, easing: "ease-out" };
const REWIND = { duration: 200, easing: "ease-out" };

// A theme color (#rrggbb) at part strength: a tile behind a glyph, a wash, a clock line.
const alpha = (c, aa, fallback) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? `${c}${aa}` : fallback);

function programIcon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// What a notification is, from the props Herdr gives its toast mod.
function itemOf(p) {
  const terminal = agentTarget(p);
  const item = {
    title: String(p.title ?? ""), body: p.body == null ? "" : String(p.body), level: p.level, icon: p.icon,
    action: p.action, timeout: p.timeout, terminal, kind: null, reason: null,
  };
  const live = terminal ? agents().find((a) => a.address === terminal) : null;
  if (terminal) {
    item.kind = kindOf(p, live?.status);
    const term = terminals().find((x) => x.address === terminal);
    item.reason = term?.status?.kind ?? term?.report?.kind ?? null;
  }
  item.total = timeoutFor(item, Boolean(live));
  return item;
}

export default class AgentToast extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.hoverRow = null;
    this.closed = false;
    const dock = currentSidebar("agent-toast");
    this.inSidebar = Boolean(dock);
    this.dockWidth = dock?.node.size?.px ?? WIDTH;
    if (this.inSidebar || p.role === "stack") return this.startStack(cx);
    const now = Date.now();
    const item = itemOf(p);
    if (!checking() && p.overlay && stack.alive(now)) {
      stack.add(item, now);
      stack.wake();
      this.handed = true;
      closeOverlay(p.overlay);
      return;
    }
    // No stack in this layout: Herdr's own toast shows it, and decides how long.
    this.solo = new Stack().add({ ...item, total: 0 }, now); // Herdr's clock, not ours
    Object.assign(this.solo, { step: 1, entered: true });
    this.read(this.solo, cx);
  }

  startStack(cx) {
    this.isStack = true;
    this.paused = false;
    this.open = false;
    this.lastHover = 0;
    stack.beat = Date.now();
    cx.timer.every(TICK, (cx) => this.tick(cx));
    // A copy that adds a toast wakes this one to draw it. The loop then runs inside that
    // copy's call, so it only redraws: work started here would belong to the closing toast.
    cx.spawn(async (cx) => {
      for (;;) {
        await stack.changed();
        cx.notify();
      }
    });
    // A transition runs from what one render shows to what the next one does: a new row is
    // drawn folded, and this redraws it a frame later at its size.
    cx.spawn(async (cx) => {
      for (;;) {
        await new Promise((resolve) => { this.pulse = resolve; });
        await cx.sleep(32);
        cx.notify();
      }
    });
    this.adopt(cx);
  }

  // Layout switches close the stack: toasts go back to Herdr's overlay at once.
  async close() {
    if (this.isStack) stack.beat = 0;
  }

  tick(cx) {
    const now = Date.now();
    if (!stack.toasts.length) { stack.beat = now; return; } // idle: only say the stack is here
    const hovered = this.inSidebar ? this.overDock : Boolean(placement()?.hovered);
    if (hovered) this.lastHover = now;
    const paused = hovered || appWindow()?.active === false;
    const open = hovered || now - this.lastHover < LINGER;
    let dirty = stack.tick(now, paused);
    if (this.sweep(now)) dirty = true;
    this.adopt(cx);
    if (dirty || paused !== this.paused || open !== this.open) cx.notify();
  }

  // Each new agent toast gets its last words, read off the UI thread: the row shows at
  // once and grows a line when they arrive. Called from this copy's own timer, so the
  // read belongs to the stack.
  adopt(cx) {
    for (const toast of stack.toasts) if (toast.terminal && toast.read !== toast.rev) this.read(toast, cx);
  }

  read(toast, cx) {
    if (!toast.terminal) return;
    const rev = toast.rev;
    toast.read = rev;
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["read", toast.terminal, "--lines", "80"]);
        if (r.code !== 0 || toast.rev !== rev) return;
        toast.preview = previewOf(toast.kind, r.stdout);
        toast.took = toast.kind === "done" ? turnLength(r.stdout) : null;
        cx.notify();
      } catch {}
    });
  }

  // Stale news leaves by itself.
  sweep(now) {
    let any = false;
    const live = agents();
    for (const toast of stack.toasts) {
      if (!toast.terminal || toast.leaving) continue;
      if (staleNews(toast, live.find((a) => a.address === toast.terminal), now) && stack.dismiss(toast.id, now)) any = true;
    }
    return any;
  }

  leave(toast, cx) {
    if (this.isStack) {
      stack.dismiss(toast.id, Date.now());
      if (this.hoverRow === toast.id) this.hoverRow = null;
      cx?.notify();
    } else if (!this.closed) {
      this.closed = true;
      closeOverlay(props()?.overlay);
    }
  }

  render(cx) {
    const t = theme();
    if (this.handed) return div();
    if (!this.isStack) return this.renderSolo(t, cx);

    const now = Date.now();
    this.sweep(now);
    const list = stack.toasts;
    if (this.inSidebar) {
      for (const toast of list) if (toast.step === 0) { toast.step = 1; toast.entered = true; }
      return this.sidebarStack(t, list);
    }
    if (!list.length) return div(); // nothing to say: the float hides
    const place = placement();
    const hovered = Boolean(place?.hovered);
    if (hovered) this.lastHover = now;
    this.open = hovered || now - this.lastHover < LINGER;
    this.paused = hovered || appWindow()?.active === false;

    // Newest next to the edge the float is anchored to, so the rows under the pointer
    // stay put when older ones unfold. Past SHOWN, the oldest fold away until hovered.
    const active = list.filter((x) => !x.leaving);
    const extra = Math.max(0, active.length - SHOWN);
    const folded = new Set(this.open ? [] : active.slice(0, extra).map((x) => x.id));
    const rows = list.map((toast) => this.row(t, toast, folded.has(toast.id)));
    const more = this.more(t, extra, active.length);
    const top = place?.edge === "top" || (place?.vertical && place.align === "start");

    let started = false;
    for (const toast of list) if (toast.step === 0) { toast.step = 1; toast.entered = true; started = true; }
    if (started) this.pulse?.();
    return v_flex().id("agent-toasts").w(WIDTH).children(top ? [more, ...rows.reverse()] : [...rows, more]);
  }

  sidebarStack(t, list) {
    const compact = this.dockWidth < 160;
    const fold = sidebarButton("agent-toast", this.dockWidth);
    const rows = list.filter(toast => !toast.leaving).reverse();
    const header = h_flex().h(32).flex_none().items_center()
      .when(compact, el => el.justify_center())
      .when(!compact, el => el.px(8).child(div().flex_1().text_size(12).text_color(t.muted).child("Notifications")))
      .when(fold, el => el.child(fold));
    return v_flex().id("toast-sidebar").size_full().min_h(0).bg(t.chrome)
      .on_size_change((size, cx) => {
        const width = size.width / Number(settings().zoom ?? 1);
        if (this.dockWidth !== width) { this.dockWidth = width; cx.notify(); }
      })
      .on_hover((over, cx) => { this.overDock = over; this.paused = over || appWindow()?.active === false; cx.notify(); })
      .child(header)
      .child(v_flex().id("toast-list").w_full().flex_1().min_h(0).gap(6).overflow_y_scroll()
        .when(compact, el => el.items_center())
        .when(!rows.length, el => el.child(div().id("no-toasts").px(4).text_size(11).text_color(t.dim)
          .tooltip("No notifications").accessibility_label("No notifications").child(compact ? "–" : "No notifications")))
        .children(rows.map(toast => {
          if (!compact) return div().w_full().h(rowHeight(toast)).flex_none().px(INSET).child(this.card(t, toast));
          const tip = [toast.title, toast.body].filter(Boolean).join("\n");
          const agent = toast.terminal && agents().find(a => a.address === toast.terminal);
          return div().id(`toast-${toast.id}`).size(40).flex_none().flex().items_center().justify_center().rounded(6)
            .role("button").tooltip(tip).accessibility_label(tip).cursor_pointer().hover(s => s.bg(t.hover))
            .on_click((_e, cx) => this.activate(toast, cx))
            .child(toast.terminal ? this.agentTile(t, toast, agent) : this.levelTile(t, toast));
        })));
  }

  activate(toast, cx) {
    if (toast.action?.name) run(toast.action.name, toast.action.args ?? {});
    this.leave(toast, cx);
  }

  // The toast alone, filling Herdr's own overlay.
  renderSolo(t, cx) {
    const toast = this.solo;
    if (toast.terminal && !this.closed && staleNews(toast, agents().find((a) => a.address === toast.terminal), Date.now())) {
      cx.spawn(async () => this.leave(toast));
    }
    return div().id("agent-toast").size_full().bg(t.popover).p(INSET).child(this.card(t, toast));
  }

  // A row folds open when it arrives and away when it leaves; the card inside keeps its size.
  row(t, toast, folded) {
    const height = rowHeight(toast);
    const shown = toast.entered && !toast.leaving && !folded;
    return div()
      .id(`row-${toast.id}`)
      .w(WIDTH)
      .flex_none()
      .overflow_hidden()
      .h(shown ? height : 0)
      .opacity(shown ? 1 : 0)
      .transition("height", MOVE)
      .transition("opacity", shown ? FADE_IN : FADE_OUT)
      .child(div().w(WIDTH).h(height).px(INSET).py(1).child(this.card(t, toast)));
  }

  // One notification: the whole card is the click target; × and Copy stop the click.
  card(t, toast) {
    const agent = toast.terminal ? agents().find((a) => a.address === toast.terminal) : null;
    const tone = toast.terminal ? t[(BADGE[toast.kind] ?? BADGE.done).color] : levelOf(toast).tone;
    return h_flex()
      .id(`toast-${toast.id}`)
      .relative()
      .size_full()
      .rounded(8)
      .pl(9)
      .pr(8)
      .gap(11)
      .items_center()
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_hover((hovered, cx) => {
        if (hovered) this.hoverRow = toast.id;
        else if (this.hoverRow === toast.id) this.hoverRow = null;
        cx.notify();
      })
      .on_click((_e, cx) => this.activate(toast, cx))
      // Fresh news: a wash of its color that fades out.
      .when(this.isStack, (el) => el.child(div().id(`wash-${toast.id}-${toast.rev}`).absolute().inset_0().rounded(8)
        .bg(alpha(tone, "24", t.hover)).opacity(toast.step === 0 ? 1 : 0).transition("opacity", WASH)))
      .child(toast.terminal ? this.agentTile(t, toast, agent) : this.levelTile(t, toast))
      .child(toast.terminal ? this.agentText(t, toast, agent, tone) : this.plainText(t, toast))
      .when(this.isStack && toast.total != null, (el) => el.child(this.clock(t, toast, tone)));
  }

  // The time it has left, as a line that runs out. It runs natively: render only says
  // where it's going (empty, over what's left) or, while paused, back to full.
  clock(t, toast, tone) {
    const full = (this.inSidebar ? this.dockWidth : WIDTH) - 2 * INSET - 22;
    const running = toast.step === 1 && !this.paused && !toast.leaving;
    return div().absolute().left(11).bottom(0).w(full).h(2)
      .child(div().id(`clock-${toast.id}-${toast.rev}`).h(2).rounded(1).bg(alpha(tone, "55", t.border))
        .w(running ? 0 : full)
        .transition("width", running ? { duration: Math.max(1, Math.round(toast.left)), easing: "linear" } : REWIND));
  }

  // The agent's icon on a tile (a drawn robot when its program has none), its news as a
  // badge on the corner.
  agentTile(t, toast, agent) {
    const badge = BADGE[toast.kind] ?? BADGE.done;
    const icon = programIcon(agent?.program, 19, t.foreground);
    return div()
      .relative()
      .flex_none()
      .size(34)
      .child(icon
        ? h_flex().size(34).rounded(9).bg(t.raised).border(1).border_color(t.border).items_center().justify_center().child(icon)
        : image(`${ASSETS}/icons/agent.png`).w(34).h(34))
      .child(h_flex()
        .absolute()
        .right(-4)
        .bottom(-4)
        .size(16)
        .rounded_full()
        .border(2)
        .border_color(t.popover)
        .bg(t[badge.color])
        .items_center()
        .justify_center()
        .when(toast.kind === "blocked", (el) => el.loop("opacity", { from: 0.55, to: 1, period: 1400 }))
        .child(svg(`${ASSETS}/${badge.glyph}.svg`).size(9).text_color(t.popover)));
  }

  // A plain notification's icon: the caller's own on a tile, else the drawn one for its level.
  levelTile(t, toast) {
    if (toast.icon) {
      return h_flex().flex_none().size(34).rounded(9).bg(t.raised).items_center().justify_center()
        .child(image(toast.icon).w(19).h(19).flex_none());
    }
    return image(`${ASSETS}/icons/${levelOf(toast).icon}.png`).w(34).h(34).flex_none();
  }

  // The task, then its state and where it runs, then its last words.
  agentText(t, toast, agent, tone) {
    const tab = agent ? spaces().flatMap((s) => s.tabs).find((x) => x.id === agent.tab) : null;
    const title = agent ? agentTitle(agent, tab) : toast.title.replace(/\s+(finished|needs you)\s*$/i, "") || "Agent";
    const where = whereOf(agent, tab, title, toast.body);
    const word = statusWord(toast.kind, toast.reason) + (toast.took ? ` in ${toast.took}` : "");
    return v_flex()
      .flex_1()
      .min_w(0)
      .gap(1)
      .child(this.titleLine(t, toast, title))
      .child(h_flex().gap(6).items_center().text_size(12).min_w(0)
        .child(div().flex_none().font_medium().text_color(tone).child(word))
        .when(Boolean(where), (el) => el
          .child(div().flex_none().text_color(t.dim).child("·"))
          .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(where))))
      .when(Boolean(toast.preview), (el) => el.child(
        div().truncate().text_size(12).text_color(t.dim).child(toast.preview)));
  }

  // Any other notify(): the title and up to two lines of body. Herdr's machine-login
  // toast keeps its Copy button.
  plainText(t, toast) {
    const login = loginHint(toast.body);
    return v_flex()
      .flex_1()
      .min_w(0)
      .gap(1)
      .child(this.titleLine(t, toast, login ? `${login.machine} needs a login` : toast.title))
      .when(!login && Boolean(toast.body), (el) => el.child(
        div().max_h(36).overflow_hidden().text_size(12).text_color(t.muted).child(toast.body)))
      .when(Boolean(login), (el) => el.child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().tooltip(login.command).text_size(12).text_color(t.muted).child(login.command))
        .child(div().id(`copy-${toast.id}`).flex_none().px(6).py(2).rounded(4).bg(t.raised)
          .text_size(11.5).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.selected ?? t.hover))
          .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(login.command); toast.copied = true; cx.notify(); })
          .child(toast.copied ? "Copied" : "Copy"))));
  }

  titleLine(t, toast, title) {
    return h_flex().gap(8).items_center()
      .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(13).text_color(t.foreground).child(title))
      .child(div()
        .id(`dismiss-${toast.id}`)
        .flex_none()
        .size(18)
        .rounded(5)
        .flex()
        .items_center()
        .justify_center()
        .text_color(t.dim)
        .hover((s) => s.bg(t.raised).text_color(t.foreground))
        .tooltip("Dismiss")
        .when(this.hoverRow !== toast.id, (el) => el.invisible())
        .on_click((_e, cx) => { cx.stop_propagation(); this.leave(toast, cx); })
        .child(svg(`${ASSETS}/x.svg`).size(11)));
  }

  // Past SHOWN toasts: how many are folded away, and a way to clear them all. It sits on
  // the anchored edge, so it doesn't move when the stack unfolds.
  more(t, extra, count) {
    const shown = extra > 0;
    if (shown) this.moreText = this.open ? `${count} notifications` : `${extra} more`;
    return div()
      .id("toasts-more")
      .w(WIDTH)
      .flex_none()
      .overflow_hidden()
      .h(shown ? MORE : 0)
      .opacity(shown ? 1 : 0)
      .transition("height", MOVE)
      .transition("opacity", shown ? FADE_IN : FADE_OUT)
      .child(h_flex().w(WIDTH).h(MORE).pl(INSET + 9).pr(INSET + 4).gap(8).items_center().text_size(11.5)
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(this.moreText ?? ""))
        .child(div().id("toasts-clear").flex_none().px(6).py(2).rounded(4).text_color(t.muted).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); stack.clear(Date.now()); this.hoverRow = null; cx.notify(); })
          .child("Clear all")));
  }
}
