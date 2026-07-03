import {term, DEBUG} from "../main";

/**
 * Gets the entire visible viewport content as an array of strings
 * @returns Array of all visible terminal lines
 */
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

/**
 * Gets the last N lines from the terminal buffer relative to cursor position
 * @param n - Number of lines to retrieve
 * @returns Array of the last n lines
 */
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

export function getCurrentLine(): string {
    return getLastLines(1)[0] || "";
}

// If you're dialing, then the speed (baud speed) of output
// will decrease
// you will hav to wait longer for the output to stabilize
// before this function returns

// change the pollinterval to the baud speed (not supported yet)

/**
 * Waits for a specific string or regex pattern to appear in the terminal output
 * Polls the terminal buffer until the pattern is found or timeout is reached
 * 
 * **If you're dialing then the speed (baud speed) of output will decrease**
 * 
 * You wil have to wait longer for the output to stabilize before this function returns
 * 
 * Using a proxy / VPN may also slow down output
 * @param query - String or RegExp pattern to search for
 * @param timeout - Maximum time to wait in milliseconds (default: 10000)
 * @param lineCount - Number of lines to check (default: 1)
 * @param pollInterval - How often to check in milliseconds (default: 200)
 * @returns Promise<true> if pattern found, Promise<false> if timeout
 */
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

/**
 * Waits for the terminal output to stabilize (stop changing)
 * Useful after commands to ensure all output has been received
 * @param timeout - Maximum time to wait in milliseconds (default: 10000)
 * @param pollInterval - How often to check buffer stability in milliseconds (default: 200)
 * @returns Promise<true> if output stabilized, Promise<false> if timeout
 */
export async function waitStill(
    timeout: number = 10000,
    pollInterval: number = 200
) // need to find a way to determine the baud rate
{
    const startTime = Date.now();
    let firstBuffer = getViewport();
    let lastBuffer = getViewport();
    while (Date.now() - startTime < timeout) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        const currentBuffer = getViewport();
        if (JSON.stringify(currentBuffer) === JSON.stringify(lastBuffer) && JSON.stringify(currentBuffer) != JSON.stringify(firstBuffer)) {
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