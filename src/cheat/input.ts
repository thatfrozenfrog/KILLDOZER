import type { Pane } from "../pane";
import { writeToPty } from "../shell";
import { sleep, randint, DEBUG } from "../gadget";
import * as stdout from "./output";

/** Every writer targets one pane's session. */

const SPECIAL_KEY_SEQUENCES = {
  Backspace: "\x7F",
  Enter: "\r",
  Tab: "\t",
  Esc: "\x1b",
  Up: "\x1b[A",
  Down: "\x1b[B",
  Right: "\x1b[C",
  Left: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  "Page Up": "\x1b[5~",
  "Page Down": "\x1b[6~",
  Insert: "\x1b[2~",
  Delete: "\x1b[3~",
  F1: "\x1bOP",
  F2: "\x1bOQ",
  F3: "\x1bOR",
  F4: "\x1bOS",
  F5: "\x1b[15~",
  F6: "\x1b[17~",
  F7: "\x1b[18~",
  F8: "\x1b[19~",
  F9: "\x1b[20~",
  F10: "\x1b[21~",
  F11: "\x1b[23~",
  F12: "\x1b[24~",
};

function combination(ch: string, modifiers = { ctrl: false, alt: false }): string {
  let result = ch;
  if (modifiers.ctrl) {
    const code = result.toUpperCase().charCodeAt(0) - 64;
    result = String.fromCharCode(code);
  }
  if (modifiers.alt) {
    result = "\x1b" + result;
  }
  return result;
}

export async function sendkey(
  pane: Pane,
  event: string,
  modifiers = { ctrl: false, alt: false }
): Promise<void> {
  let data = "";
  if (event in SPECIAL_KEY_SEQUENCES) {
    data = SPECIAL_KEY_SEQUENCES[event as keyof typeof SPECIAL_KEY_SEQUENCES];
  } else if (event.length === 1) {
    data = combination(event, modifiers);
  }
  if (data) {
    if (DEBUG) console.log("Sending key:", JSON.stringify(data));
    writeToPty(pane, data);
  }
}

export async function send(pane: Pane, data: string): Promise<void> {
  writeToPty(pane, data);
}

function weightedRandom(min: number, max: number, bias = 0.7): number {
  const r = Math.pow(Math.random(), bias);
  return min + r * (max - min);
}

export async function type(
  pane: Pane,
  data: string,
  option?: { min?: number; max?: number; pause?: number }
): Promise<void> {
  const min = option?.min ?? 35;
  const max = option?.max ?? 110;
  const pause = option?.pause ?? 0.03;

  let momentum = 0;
  for (let i = 0; i < data.length; i++) {
    const chr = data[i];
    await send(pane, chr);
    const next = data[i + 1] ?? "";

    momentum = /[a-zA-Z0-9]/.test(chr) ? Math.min(momentum + 0.08, 1) : 0;
    let delay = weightedRandom(min, max);
    delay *= 1 - momentum * 0.4;
    if (/[.,!?;:]/.test(chr)) delay += randint(150, 300);
    if (chr === " ") delay += randint(80, 220);
    if (Math.random() < pause && /[a-zA-Z0-9]/.test(chr)) delay += randint(300, 800);
    if (/[.!?]/.test(chr) && next === " ") delay += randint(300, 800);
    await sleep(delay);
  }
}

/** Executes a Telehack command on a pane and returns its output lines. */
export async function th_exec(pane: Pane, command: string, lag: number = 100): Promise<Array<string>> {
  await send(pane, command);
  await pane.term.write("\u1499");
  await sendkey(pane, "Enter");
  await stdout.waitStill(pane, 10000, lag);
  if (stdout.getLastLines(pane, 1)[0].includes("More")) {
    while (stdout.getLastLines(pane, 1)[0].includes("More")) {
      await send(pane, " ");
      await stdout.waitStill(pane, 10000, lag);
    }
  }
  const buffer = pane.term.buffer.active;
  const cur = buffer.baseY + buffer.cursorY;
  const lines: string[] = [];
  for (let i = cur; i >= 0; i--) {
    const line = buffer.getLine(i);
    if (line) {
      const text = line.translateToString(true);
      if (text.includes("\u1499")) break;
      lines.unshift(text);
    }
  }
  return lines;
}
