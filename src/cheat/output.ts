import {term, DEBUG} from "../main";

export function getViewport(): Array<string> {
    let buffer = [] as string[];
    if (!term) {return buffer;}
    const lineCount = term.buffer.active.length;
    for (let i = 0; i < lineCount; i++) {
        const line = term.buffer.active.getLine(i);
        if (line) {
            buffer.push(line.translateToString(true));
        }
    }
    return buffer;
}

export function getLastLines(n: number): Array<string> {
    let buffer = [] as string[];
    if (!term) {return buffer;}
    const active = term.buffer.active;
    let i = Math.max(0, active.baseY + active.cursorY - n + 1);
    const end = active.baseY + active.cursorY;
    for (; i <= end; i++) {
        const line = term.buffer.active.getLine(i);
        if (line) {
            buffer.push(line.translateToString(true));
        }
    }
    return buffer;
}

// If you're dialing, then the speed (baud speed) of output
// will decrease
// you will hav to wait longer for the output to stabilize
// before this function returns

// change the pollinterval to the baud speed (not supported yet)
export async function waitFor(
    query: string | RegExp,
    timeout: number = 10000,
    lineCount: number = 1,
    pollInterval: number = 200
): Promise<boolean> {
    const startTime = Date.now();
    const matcher = typeof query === "string"
        ? (line: string[]) => line.some(line => line.includes(query as string))
        : (line: string[]) => line.some(line => (query as RegExp).test(line));
    while (Date.now() - startTime < timeout) {
        const lines = getLastLines(lineCount);
        if (matcher(lines)){
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
    return false;
}

export async function waitStill(
    timeout: number = 10000,
    pollInterval: number = 200
) // need to find a way to determine the baud rate
{
    const startTime = Date.now();
    let lastBuffer = getViewport();
    while (Date.now() - startTime < timeout) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        const currentBuffer = getViewport();
        if (JSON.stringify(currentBuffer) === JSON.stringify(lastBuffer)) {
            return true;
        }
        lastBuffer = currentBuffer;
    }
    return false;
}


if (DEBUG) {
    (window as any).getViewport = getViewport;
    (window as any).getLastLines = getLastLines;
    (window as any).waitFor = waitFor;
}