import type { Pane } from "../pane";

/** Every reader operates on one pane's terminal buffer. */

export function getViewport(pane: Pane): Array<string> {
  const buffer: string[] = [];
  const lineCount = pane.term.buffer.active.length;
  for (let i = 0; i < lineCount; i++) {
    const line = pane.term.buffer.active.getLine(i);
    if (line) buffer.push(line.translateToString(true));
  }
  return buffer;
}

export function getLastLines(pane: Pane, n: number): Array<string> {
  const buffer: string[] = [];
  const active = pane.term.buffer.active;
  let i = Math.max(0, active.baseY + active.cursorY - n + 1);
  const end = active.baseY + active.cursorY;
  for (; i <= end; i++) {
    const line = active.getLine(i);
    if (line) buffer.push(line.translateToString(true));
  }
  return buffer;
}

export function getCurrentLine(pane: Pane): string {
  return getLastLines(pane, 1)[0] || "";
}

export async function waitFor(
  pane: Pane,
  query: string | RegExp,
  timeout: number = 10000,
  lineCount: number = 1,
  pollInterval: number = 200
): Promise<boolean> {
  const startTime = Date.now();
  const matcher =
    typeof query === "string"
      ? (lines: string[]) => lines.some((line) => line.includes(query as string))
      : (lines: string[]) => lines.some((line) => (query as RegExp).test(line));
  while (Date.now() - startTime < timeout) {
    if (matcher(getLastLines(pane, lineCount))) return true;
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
  return false;
}

export async function waitStill(
  pane: Pane,
  timeout: number = 10000,
  pollInterval: number = 200
): Promise<boolean> {
  const startTime = Date.now();
  const firstBuffer = getViewport(pane);
  let lastBuffer = getViewport(pane);
  while (Date.now() - startTime < timeout) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
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
