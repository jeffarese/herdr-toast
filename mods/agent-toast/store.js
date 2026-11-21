// The toasts on screen. One instance is shared by every copy of the mod: each
// notification's own copy adds its news here and closes, the stack draws them.
// Times are passed in, so the rules can be tested without a clock.

export const LIMIT = 8; // most kept at once: the oldest leaves to make room
export const SHOWN = 3; // rows shown while the pointer is elsewhere
export const EXIT_MS = 260; // how long a leaving row takes to fold away
const BEAT_MS = 2000; // a stack that hasn't ticked for this long isn't drawing

const sameNews = (toast, item) =>
  item.terminal
    ? toast.terminal === item.terminal
    : !toast.terminal && toast.title === item.title && toast.body === item.body && toast.level === item.level;

export class Stack {
  constructor() {
    this.toasts = []; // oldest first
    this.seq = 0;
    this.beat = 0;
    this.waiting = [];
  }

  // A stack is drawing these: its timer ran a moment ago.
  alive(now) {
    return now - this.beat < BEAT_MS;
  }

  // Resolves at the next wake(): how a copy that adds a toast reaches the copy that draws it.
  changed() {
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  wake() {
    const waiting = this.waiting;
    this.waiting = [];
    for (const resolve of waiting) resolve();
  }

  // News about the same agent (or the same words again) renews its row rather than adding one.
  add(item, now) {
    const same = this.toasts.find((toast) => !toast.leaving && sameNews(toast, item));
    if (same) {
      Object.assign(same, item, { rev: same.rev + 1, step: 0, born: now, left: item.total, last: now, armed: false, copied: false });
      if (item.terminal) Object.assign(same, { preview: null, took: null });
      return same;
    }
    const toast = {
      ...item,
      id: `n${++this.seq}`,
      rev: 0, // goes up each time the row is renewed
      born: now,
      step: 0, // 0: drawn at its start; 1: at rest
      entered: false,
      left: item.total, // ms until it leaves by itself; total null: it stays
      last: now,
      leaving: null,
      armed: false,
      read: -1,
      preview: null,
      took: null,
      copied: false,
    };
    this.toasts.push(toast);
    const active = this.toasts.filter((x) => !x.leaving);
    for (const old of active.slice(0, Math.max(0, active.length - LIMIT))) old.leaving = now;
    return toast;
  }

  dismiss(id, now) {
    const toast = this.toasts.find((x) => x.id === id);
    if (!toast || toast.leaving) return false;
    toast.leaving = now;
    return true;
  }

  clear(now) {
    let any = false;
    for (const toast of this.toasts) if (!toast.leaving) { toast.leaving = now; any = true; }
    return any;
  }

  // Runs the clocks. While paused (the pointer is on the stack, or nobody is at the
  // window) every clock goes back to its start. True when a row left or was removed.
  tick(now, paused) {
    this.beat = now;
    let changed = false;
    for (const toast of this.toasts) {
      if (toast.leaving) continue;
      if (paused || toast.total == null) {
        toast.left = toast.total;
      } else {
        toast.left -= now - toast.last;
        if (toast.left <= 0) { toast.leaving = now; changed = true; }
      }
      toast.last = now;
    }
    const kept = this.toasts.filter((toast) => !toast.leaving || now - toast.leaving < EXIT_MS);
    if (kept.length !== this.toasts.length) { this.toasts = kept; changed = true; }
    return changed;
  }
}

export const stack = new Stack();
