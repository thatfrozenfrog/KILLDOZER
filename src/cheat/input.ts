import { invoke } from "@tauri-apps/api/core";
import type { Pane } from "../terminal/pane.ts";
import { writeToPty } from "../terminal/shell.ts";
import { sleep, randint, DEBUG } from "../core/gadget.ts";
import * as stdout from "./output.ts";

/** Every writer targets one pane's session. */

export const MAGIC_NUMBER = 31337;

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

function combination(
  ch: string,
  modifiers = { ctrl: false, alt: false },
): string {
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
  modifiers = { ctrl: false, alt: false },
  generation?: number,
): Promise<boolean> {
  const gen = generation ?? pane.sessionGeneration;
  if (pane.sessionGeneration !== gen) return false;
  let data = "";
  if (event in SPECIAL_KEY_SEQUENCES) {
    data = SPECIAL_KEY_SEQUENCES[event as keyof typeof SPECIAL_KEY_SEQUENCES];
  } else if (event.length === 1) {
    data = combination(event, modifiers);
  }
  if (data) {
    if (DEBUG) console.log("Sending key:", JSON.stringify(data));
    return await writeToPty(pane, data, gen);
  }
  return false;
}

function isSafeMode(pane: Pane): { enabled: boolean; wpm: number } {
  for (const cat of Object.keys(pane.cheats)) {
    const cheat = pane.cheats[cat].find(
      (c) => c.name.toLowerCase() === "safe mode",
    );
    if (cheat?.enabled) {
      const wpm = Number(cheat.getValue("WPM")) || 60;
      return { enabled: true, wpm };
    }
  }
  return { enabled: false, wpm: 60 };
}

function routeSendText(pane: Pane, data: string): boolean {
  const turboEnabled = Object.values(pane.cheats).some((cheats) =>
    cheats.some(
      (cheat) => cheat.name.toLowerCase() === "turbo mode" && cheat.enabled,
    ),
  );
  if (!data || !turboEnabled) return false;

  pane.term.paste(data);
  return true;
}

export async function send(
  pane: Pane,
  data: string,
  raw = false,
  generation?: number,
): Promise<boolean> {
  const gen = generation ?? pane.sessionGeneration;
  if (pane.sessionGeneration !== gen) return false;
  if (!raw && data.length > 0) {
    if (routeSendText(pane, data)) return true;
    const safe = isSafeMode(pane);
    if (safe.enabled) {
      const baseDelay = 12000 / Math.max(1, safe.wpm);
      return await type(pane, data, {
        min: Math.max(5, Math.round(baseDelay * 0.7)),
        max: Math.max(10, Math.round(baseDelay * 1.3)),
        generation: gen,
      });
    }
  }
  return await writeToPty(pane, data, gen);
}

function weightedRandom(min: number, max: number, bias = 0.7): number {
  const r = Math.pow(Math.random(), bias);
  return min + r * (max - min);
}

export async function type(
  pane: Pane,
  data: string,
  option?: { min?: number; max?: number; pause?: number; generation?: number },
): Promise<boolean> {
  const generation = option?.generation ?? pane.sessionGeneration;
  const min = option?.min ?? 35;
  const max = option?.max ?? 110;
  const pause = option?.pause ?? 0.03;

  let momentum = 0;
  for (let i = 0; i < data.length; i++) {
    if (pane.sessionGeneration !== generation) return false;
    const chr = data[i];
    const written = await writeToPty(pane, chr, generation);
    if (!written || pane.sessionGeneration !== generation) return false;
    const next = data[i + 1] ?? "";

    momentum = /[a-zA-Z0-9]/.test(chr) ? Math.min(momentum + 0.08, 1) : 0;
    let delay = weightedRandom(min, max);
    delay *= 1 - momentum * 0.4;
    if (/[.,!?;:]/.test(chr)) delay += randint(150, 300);
    if (chr === " ") delay += randint(80, 220);
    if (Math.random() < pause && /[a-zA-Z0-9]/.test(chr))
      delay += randint(300, 800);
    if (/[.!?]/.test(chr) && next === " ") delay += randint(300, 800);
    await sleep(delay);
    if (pane.sessionGeneration !== generation) return false;
  }
  return true;
}

export interface ThExecResult extends Array<string> {
  status: "completed" | "timed-out" | "failed" | "aborted";
  ok: boolean;
}

function createThExecResult(
  lines: string[],
  status: "completed" | "timed-out" | "failed" | "aborted",
): ThExecResult {
  const res = [...lines] as ThExecResult;
  res.status = status;
  res.ok = status === "completed";
  return res;
}

/** Executes a Telehack command on a pane and returns its output lines without pagination. */
export async function th_exec(
  pane: Pane,
  command: string,
  lagOrOptions?: number | { lag?: number; timeout?: number },
): Promise<ThExecResult> {
  const generation = pane.sessionGeneration;
  if (pane.state !== "connected") {
    return createThExecResult([], "failed");
  }

  const options =
    typeof lagOrOptions === "number" ? { lag: lagOrOptions } : lagOrOptions;
  const rtt = pane.latency ?? 100;
  const effectiveLag =
    options?.lag ?? Math.min(1500, Math.max(150, Math.round(rtt * 1.3)));
  const effectiveTimeout = options?.timeout ?? Math.max(10000, rtt);

  pane.busy = true;

  const spoof = pane.cheats.Misc?.find(
    (c) => c.name === "Terminal spoof" && c.enabled,
  );
  const origRows = spoof
    ? Math.max(2, Math.round(Number(spoof.getValue("Rows")) || 24))
    : pane.term.rows;
  const origCols = spoof
    ? Math.max(2, Math.round(Number(spoof.getValue("Cols")) || 80))
    : pane.term.cols;
  const origScrollback = pane.term.options.scrollback ?? 1000;

  // Temporarily disable truncation and lock custom size override
  pane.customSizeOverride = { rows: MAGIC_NUMBER, cols: origCols };
  pane.term.options.scrollback = 500_000;

  if (pane.state === "connected" && pane.sessionId) {
    await invoke("async_resize_pty", {
      sessionId: pane.sessionId,
      rows: MAGIC_NUMBER,
      cols: origCols,
    }).catch(() => {});
  }

  let status: "completed" | "timed-out" | "failed" | "aborted" = "completed";
  const lines: string[] = [];

  try {
    const writeOk = await send(pane, command, false, generation);
    if (!writeOk) {
      status = "failed";
      return createThExecResult([], status);
    }
    await new Promise<void>((resolve) => pane.term.write("\u{1F95D}", resolve));
    const enterOk = await sendkey(
      pane,
      "Enter",
      { ctrl: false, alt: false },
      generation,
    );
    if (!enterOk) {
      status = "failed";
      return createThExecResult([], status);
    }

    const still = await stdout.waitStill(pane, effectiveTimeout, effectiveLag);
    if (pane.sessionGeneration !== generation) {
      status = "aborted";
    } else if (!still) {
      status = "timed-out";
    }

    const buffer = pane.term.buffer.active;
    const cur = buffer.baseY + buffer.cursorY;
    for (let i = cur; i >= 0; i--) {
      const line = buffer.getLine(i);
      if (line) {
        const text = line.translateToString(true);
        if (text.includes("\u{1F95D}")) break;
        lines.unshift(text);
      }
    }
    return createThExecResult(lines, status);
  } finally {
    pane.term.options.scrollback = origScrollback;
    pane.customSizeOverride = null;
    // Restore original dimensions
    if (
      pane.state === "connected" &&
      pane.sessionId &&
      pane.sessionGeneration === generation
    ) {
      await invoke("async_resize_pty", {
        sessionId: pane.sessionId,
        rows: origRows,
        cols: origCols,
      }).catch(() => {});
    }
    if (pane.sessionGeneration === generation) {
      pane.busy = false;
    }
  }
}
