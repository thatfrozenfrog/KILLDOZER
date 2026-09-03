import type { Pane } from "../pane";

/** Every reader operates on one pane's terminal buffer. */

export function getLogicalLines(
  pane: Pane,
  startRow = 0,
  endRow?: number
): string[] {
  if (!pane.term?.buffer?.active) {
    return [];
  }
  const lines: string[] = [];
  const active = pane.term.buffer.active;
  const maxRow = Math.min(endRow ?? active.length, active.length);
  for (let i = Math.max(0, startRow); i < maxRow; i++) {
    const l = active.getLine(i);
    if (!l) continue;
    const str = l.translateToString(true);
    if (l.isWrapped && lines.length) lines[lines.length - 1] += str;
    else lines.push(str);
  }
  return lines;
}

export const getLogicalLine = getLogicalLines;

export function getViewport(pane: Pane): string[] {
  if (!pane.term?.buffer?.active) {
    return [];
  }
  const buffer = pane.term.buffer.active;
  const viewportY = buffer.viewportY || 0;
  const rows = pane.term.rows || 24;
  const lines = getLogicalLines(pane, viewportY, viewportY + rows);
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start++;
  while (end > start && !lines[end - 1].trim()) end--;
  return lines.slice(start, end);
}

export function getLastLines(pane: Pane, n: number): Array<string> {
  if (!pane.term?.buffer?.active) return [];
  const active = pane.term.buffer.active;
  return getLogicalLines(pane, 0, active.baseY + active.cursorY + 1).slice(-n);
}

export function getCurrentLine(pane: Pane): string {
  return getLastLines(pane, 1)[0] || "";
}

export async function waitFor(
  pane: Pane,
  query: string | RegExp,
  timeout?: number,
  lineCount: number = 1,
  pollInterval?: number
): Promise<boolean> {
  const rtt = pane.latency ?? 100;
  const effectiveTimeout = timeout ?? Math.max(10000, rtt * 15);
  const interval = pollInterval ?? Math.min(600, Math.max(100, Math.round(rtt * 0.8)));

  const startTime = Date.now();
  const matcher =
    typeof query === "string"
      ? (lines: string[]) => lines.some((line) => line.includes(query as string))
      : (lines: string[]) => lines.some((line) => (query as RegExp).test(line));
  while (Date.now() - startTime < effectiveTimeout) {
    if (matcher(getLastLines(pane, lineCount))) return true;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return false;
}

export async function waitStill(
  pane: Pane,
  timeout?: number,
  pollInterval?: number
): Promise<boolean> {
  const rtt = pane.latency ?? 100;
  const effectiveTimeout = timeout ?? Math.max(10000, rtt * 15);
  // Interval dynamically scales with RTT to avoid premature cutoffs on jittery/slow proxies
  const interval = pollInterval ?? Math.min(1500, Math.max(200, Math.round(rtt * 1.5)));

  const startTime = Date.now();
  const firstBuffer = getViewport(pane);
  let lastBuffer = getViewport(pane);
  while (Date.now() - startTime < effectiveTimeout) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    const currentBuffer = getViewport(pane);
    if (
      JSON.stringify(currentBuffer) === JSON.stringify(lastBuffer) &&
      JSON.stringify(currentBuffer) !== JSON.stringify(firstBuffer)
    ) {
      return true;
    }
    lastBuffer = currentBuffer;
  }
  return false;
}

/** Pauses cheat execution until the terminal receives and parses the next write. */
export function waitChange(pane: Pane, timeout?: number): Promise<boolean> {
  const rtt = pane.latency ?? 100;
  const effectiveTimeout = timeout ?? Math.max(10000, rtt * 15);

  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let done = false;

    const cleanup = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      listener.dispose();
    };

    const listener = pane.term.onWriteParsed(() => {
      cleanup();
      resolve(true);
    });

    timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, effectiveTimeout);
  });
}

export function getCursorPosition(pane: Pane): { row: number; col: number } {
  const active = pane.term.buffer.active;
  return { row: active.cursorY, col: active.cursorX };
}