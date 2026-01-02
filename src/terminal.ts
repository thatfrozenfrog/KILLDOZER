import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { c } from './gadget';
import mymyPointing from "./img/mymyPointing.png";
import "@xterm/xterm/css/xterm.css";
import "@fontsource-variable/jetbrains-mono";

const terminalElement = document.getElementById("terminal") as HTMLElement;
const fitAddon = new FitAddon();

const term = new Terminal({
  fontFamily: "JetBrains Mono Variable, JetBrains Mono, monospace",
  fontSize: 14,
  theme: {
    background: "rgb(47, 47, 47)",
  },
});

export function initTerminal() {
  term.options.convertEol = true;
  term.options.fontFamily = "monospace";

  term.loadAddon(fitAddon);
  term.open(terminalElement);

  terminalElement.tabIndex = 0;
  terminalElement.addEventListener("mousedown", () => term.focus());
}

export async function idleTerminal() {
  term.clear();
  term.reset();
  let block = `
${c("brightYellow",'M""MMMMM""M')} ${c("brightCyan","oo dP dP       dP                                     ")}
${c("brightYellow","M  MMMM' .M")} ${c("brightCyan","   88 88       88                                     ")}
${c("brightYellow","M       .MM")} ${c("brightCyan","dP 88 88 .d888b88 .d8888b. d888888b .d8888b. 88d888b. ")}
${c("brightYellow","M  MMMb. YM")} ${c("brightCyan","88 88 88 88'  \`88 88'  \`88    .d8P' 88ooood8 88'  \`88 ")}
${c("brightYellow","M  MMMMb  M")} ${c("brightCyan","88 88 88 88.  .88 88.  .88  .Y8P    88.  ... 88       ")}
${c("brightYellow","M  MMMMM  M")} ${c("brightCyan","dP dP dP \`88888P8 \`88888P' d888888P \`88888P' dP       ")}
${c("brightYellow","MMMMMMMMMMM")}                                                                                                           
`;
  term.write(
    c("brightCyan", block.replace(/\n/g, "\r\n"))
  );
  term.writeln(`\r\n${c("brightYellow", "→ Disconnected. Please connect to a shell.")}\r\n`);

  const connectButton = document.querySelector<HTMLButtonElement>("#connect-btn");
  if (!connectButton) return;
  
  const img = document.createElement("img");
  img.src = mymyPointing;
  img.style.position = "absolute";
  img.classList.add("idle-pointer-image");
  terminalElement.appendChild(img);
  
  updateIdleImagePosition();
}

export function updateIdleImagePosition() {
  const img = terminalElement.querySelector<HTMLImageElement>(".idle-pointer-image");
  const connectButton = document.querySelector<HTMLButtonElement>("#connect-btn");
  
  if (!img || !connectButton) return;
  
  const { left, top } = connectButton.getBoundingClientRect();
  img.style.width = document.body.clientWidth / 4 + "px";
  img.style.right = (document.body.clientWidth - terminalElement.clientWidth) + "px";
  img.style.top = (top - 100) + "px";
}

export async function fitTerminal(isConnected: boolean) {
  fitAddon.fit();
  if (isConnected) {
    const { invoke } = await import("@tauri-apps/api/tauri");
    void invoke("async_resize_pty", {
      cols: term.cols,
      rows: term.rows,
    });
  }
  updateIdleImagePosition();
}

export function getTerminal() {
  return term;
}

export function getTerminalElement() {
  return terminalElement;
}

export function getCursorPixelPosition() {
  const helperTextarea = terminalElement.querySelector('.xterm-helper-textarea') as HTMLElement;
  
  if (!helperTextarea) {
    return { x: 0, y: 0, relativeX: 0, relativeY: 0 };
  }
  
  const termRect = terminalElement.getBoundingClientRect();
  const left = parseInt(helperTextarea.style.left) || 0;
  const top = parseInt(helperTextarea.style.top) || 0;
  
  return {
    x: termRect.left + left,
    y: termRect.top + top,
    relativeX: left,
    relativeY: top,
    col: term.buffer.active.cursorX,
    row: term.buffer.active.cursorY
  };
}
