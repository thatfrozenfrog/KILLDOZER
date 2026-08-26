import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import type { ConnectionConfig, ConnectionState } from "./types";
import type { CheatState } from "./cheat/registry";
import { currentScheme, xtermTheme } from "./theme";
import { c } from "./gadget";

export const panesBySession = new Map<string, Pane>();

const paneByTermEl = new Map<Element, Pane>();
const resizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    paneByTermEl.get(entry.target)?.fit();
  }
});

let paneSeq = 0;
const RESIZE_IPC_THROTTLE_MS = 100;

export class Pane {
  readonly id = `pane-${++paneSeq}`;
  sessionId: string | null = null;
  state: ConnectionState = "disconnected";
  /** automation lock: a cheat is mid-interaction with this pane's terminal */
  busy = false;
  /** belongs to the default profile tab; its edits persist as app defaults */
  isDefault = false;
  connection: ConnectionConfig;
  cheats: CheatState;
  term: Terminal;
  fitAddon: FitAddon;
  el: HTMLElement;
  termEl: HTMLElement;
  private statusDot: HTMLElement;
  private lastResizeIpc = 0;

  constructor(connection: ConnectionConfig, cheats: CheatState) {
    this.connection = connection;
    this.cheats = cheats;

    this.fitAddon = new FitAddon();
    this.term = new Terminal({
      fontFamily: "JetBrains Mono Variable, JetBrains Mono, monospace",
      fontSize: 14,
      theme: xtermTheme(currentScheme().palette),
    });
    this.term.options.convertEol = true;
    this.term.loadAddon(this.fitAddon);

    this.el = document.createElement("div");
    this.el.className = "pane";
    this.el.dataset.paneId = this.id;

    const toolbar = document.createElement("div");
    toolbar.className = "pane-toolbar";
    this.statusDot = document.createElement("span");
    this.statusDot.className = "pane-status-dot disconnected";
    const label = document.createElement("span");
    label.className = "pane-label";
    label.dataset.role = "label";
    const spacer = document.createElement("span");
    spacer.className = "spacer";
    toolbar.append(this.statusDot, label, spacer);
    for (const [action, text, title] of [
      ["split-right", "\u25A7", "Split right"],
      ["split-down", "\u2B12", "Split down"],
      ["overflow", "\u22EF", "Pane actions"],
      ["close", "\u00D7", "Close pane"],
    ] as const) {
      const btn = document.createElement("button");
      btn.className = "pane-btn";
      btn.dataset.action = action;
      btn.textContent = text;
      btn.title = title;
      btn.setAttribute("aria-label", title);
      toolbar.appendChild(btn);
    }

    this.termEl = document.createElement("div");
    this.termEl.className = "pane-terminal";
    this.el.append(toolbar, this.termEl);

    this.term.open(this.termEl);
    this.termEl.tabIndex = 0;
    this.termEl.addEventListener("mousedown", () => this.term.focus());

    paneByTermEl.set(this.termEl, this);
    resizeObserver.observe(this.termEl);
  }

  identity(): string {
    return (this.connection.username || "guest").trim() || "guest";
  }

  applyTheme(): void {
    this.term.options.theme = xtermTheme(currentScheme().palette);
  }

  setState(state: ConnectionState): void {
    this.state = state;
    this.statusDot.className = "pane-status-dot " + state;
    const label = this.el.querySelector<HTMLElement>('[data-role="label"]');
    if (label) label.textContent = this.identity();
  }

  fit(): void {
    if (!this.termEl.offsetParent) return;
    const dims = this.fitAddon.proposeDimensions();
    if (!dims || dims.cols < 2 || dims.rows < 2) return;
    this.fitAddon.fit();
    if (this.state === "connected" && this.sessionId) {
      const now = performance.now();
      if (now - this.lastResizeIpc >= RESIZE_IPC_THROTTLE_MS) {
        this.lastResizeIpc = now;
        void invoke("async_resize_pty", {
          sessionId: this.sessionId,
          rows: this.term.rows,
          cols: this.term.cols,
        }).catch(() => {});
      }
    }
  }

  /** Force a fit and an immediate (unthrottled) PTY resize. */
  refitNow(): void {
    this.lastResizeIpc = 0;
    this.fit();
  }

  showIdle(): void {
    this.term.clear();
    this.term.reset();
    const block =
      "\n" +
      c("brightYellow", 'M""MMMMM""M') + " " + c("brightCyan", "oo dP dP       dP                                     ") + "\n" +
      c("brightYellow", "M  MMMM' .M") + " " + c("brightCyan", "   88 88       88                                     ") + "\n" +
      c("brightYellow", "M       .MM") + " " + c("brightCyan", "dP 88 88 .d888b88 .d8888b. d888888b .d8888b. 88d888b. ") + "\n" +
      c("brightYellow", "M  MMMb. YM") + " " + c("brightCyan", "88 88 88 88'  `88 88'  `88    .d8P' 88ooood8 88'  `88 ") + "\n" +
      c("brightYellow", "M  MMMMb  M") + " " + c("brightCyan", "88 88 88 88.  .88 88.  .88  .Y8P    88.  ... 88       ") + "\n" +
      c("brightYellow", "M  MMMMM  M") + " " + c("brightCyan", "dP dP dP `88888P8 `88888P' d888888P `88888P' dP       ") + "\n" +
      c("brightYellow", "MMMMMMMMMMM") + "\n";
    this.term.write(c("brightCyan", block.replace(/\n/g, "\r\n")));
    this.term.writeln(
      "\r\n" + c("brightYellow", "\u2192 Disconnected. Open the Connection drawer to dial in.") + "\r\n"
    );
  }

  dispose(): void {
    resizeObserver.unobserve(this.termEl);
    paneByTermEl.delete(this.termEl);
    this.term.dispose();
    this.el.remove();
  }
}
