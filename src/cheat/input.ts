import { c } from "../gadget";
import { term, DEBUG } from "../main";
import { writeToPty } from "../shell";
import {sleep, randint} from "../gadget";
import * as stdout from "./output";

const SPECIAL_KEY_SEQUENCES = {
    Backspace: "\x7F",
    Enter: "\r",
    Tab: "\t",
    Esc: "\x1b",
    // Navigation
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
    // Function keys
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

function combination(ch:string, modifiers = {ctrl: false, alt: false}): string {
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

export async function sendkey(event: string, modifiers = {ctrl: false, alt: false}) {
    let data = "";
    if (event in SPECIAL_KEY_SEQUENCES) {
        data = SPECIAL_KEY_SEQUENCES[event as keyof typeof SPECIAL_KEY_SEQUENCES];
    } else if (event.length === 1) {
        data = combination(event, modifiers);
    }
    if (data) {
        if (DEBUG) {
            console.log(`Sending key: ${JSON.stringify(data)}`);
        }
        writeToPty(data);
    }
}


export async function send(data: string) {
    if (!term) return;
    writeToPty(data);
}

function weightedRandom(min: number, max: number, bias = 0.7) {
  const r = Math.pow(Math.random(), bias);
  return min + r * (max - min);
}

export async function type(
    data: string, 
    option?: {
        min?: number;
        max?: number;
        pause?: number; //← pause chance
    }
) {
    const min = option?.min ?? 35;
    const max = option?.max ?? 110;
    const pause = option?.pause ?? 0.03;

    let momentum = 0;
    for (let i = 0; i < data.length; i++) {
        const chr = data[i];
        await send(chr);
        const prev = data[i - 1] ?? "";
        const next = data[i + 1] ?? "";

        if (/[a-zA-Z0-9]/.test(chr)){
            momentum = Math.min(momentum + 0.08, 1);
        }
        else {
            momentum = 0;
        }
        let delay = weightedRandom(min, max);
        delay *= 1 - momentum * 0.4;

        if (/[.,!?;:]/.test(chr)) {
            delay += randint(150, 300);
        }
        if (chr === " ") delay += randint(80, 220);
        if (Math.random() < pause && /[a-zA-Z0-9]/.test(chr)) {
            delay += randint(300, 800);
        }

        if (/[.!?]/.test(chr) && next === " ") {
            delay += randint(300, 800);
        }
        await sleep(delay);
    }
}

export async function th_exec(command:string, lag: number = 100): Promise<Array<string>> {
    await send(command);
    await term.write("ᛉ");
    await sendkey("Enter");
    await stdout.waitStill(10000, lag);
    if (stdout.getLastLines(1)[0].includes("More")) {
        while (true) {
            if (!stdout.getLastLines(1)[0].includes("More")) {  break; }
            await send(" ");
            await stdout.waitStill(10000, lag);
        }
    } // handle pagination
    const buffer = term.buffer.active;
    const cur = buffer.baseY + buffer.cursorY;
    let lines = [] as string[];
    for (let i = cur; i >= 0; i--) {
        const line = buffer.getLine(i);
        if (line) {
            const text = line.translateToString(true);
            if (text.includes("ᛉ")) {
                break;
            }
            lines.unshift(text);
        }
    }
    return lines;
}

if (DEBUG) {
    (window as any).sendkey = sendkey;
    (window as any).send = send;
    (window as any).type = type;
    (window as any).th_exec = th_exec;
}
