import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import "@fontsource-variable/jetbrains-mono";
import {sleep} from './gadget';
import {c} from './gadget';

import mymyPointing from "./img/mymyPointing.png";


const terminalElement = document.getElementById("terminal") as HTMLElement;
const usernameInput = document.getElementById("username") as HTMLInputElement;
const hostInput = document.getElementById("host") as HTMLInputElement;
const portInput = document.getElementById("port") as HTMLInputElement;
const connectBtn = document.getElementById("connect-btn") as HTMLButtonElement;
const disconnectBtn = document.getElementById("disconnect-btn") as HTMLButtonElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;

const fitAddon = new FitAddon();

const term = new Terminal({
  fontFamily: "JetBrains Mono Variable, JetBrains Mono, monospace",
  fontSize: 14,
  theme: {
    background: "rgb(47, 47, 47)",
  },
});
term.options.convertEol = true;
term.options.fontFamily = "monospace";

term.loadAddon(fitAddon);
term.open(terminalElement);

terminalElement.tabIndex = 0;
terminalElement.addEventListener("mousedown", () => term.focus());

let isConnected = false;
await idleTerminal();

async function idleTerminal() {
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
  let credits = `
  ${c("brightMagenta", "Killdozer - Telehack cheat client")}`




  const connectButton = document.querySelector<HTMLButtonElement>("#connect-btn");
  if (!connectButton) return;
  const { left, top } = connectButton.getBoundingClientRect();
  const curpos = { x: left, y: top };
  console.log(curpos);
  const img = document.createElement("img");
  img.src = mymyPointing;
  img.style.position = "absolute";
  img.style.width = document.body.clientWidth / 4 + "px";
  img.style.right = (document.body.clientWidth - terminalElement.clientWidth) + "px";
  img.style.top = (curpos.y-100) + "px";
  terminalElement.appendChild(img);
}
async function fitTerminal() {
  fitAddon.fit();
  if (isConnected) {
    void invoke("async_resize_pty", {
      cols: term.cols,
      rows: term.rows,
    });
  }
}

function writeToPty(data: string) {
  if (isConnected) {
    void invoke("async_write_to_pty", {
      data,
    });
  }
}

async function connectShell() {
  try {
    const img = terminalElement.querySelector("img");
    if (img) {
      terminalElement.removeChild(img);
    }
    const username = (usernameInput.value || "guest").trim() || "guest";
    const host = (hostInput.value || "telehack.com").trim() || "telehack.com";
    const port = (portInput.value || "2222").trim() || "2222";
    statusText.textContent = "Starting shell...";
    connectBtn.disabled = true;
    disconnectBtn.disabled = false;
    usernameInput.disabled = true;
    hostInput.disabled = true;
    portInput.disabled = true;

    term.writeln(c("brightCyan",`Connecting to ${username}@${host}:${port}...\r\n`));

  await invoke("async_create_shell", { username, host, port });
    
    isConnected = true;
    statusText.textContent = "Connected as" + ` ${username}@${host}:${port}`;
    
    await fitTerminal();
    term.focus();

  } catch (error) {
    statusText.textContent = "Failed to start shell";
    connectBtn.disabled = false;
    disconnectBtn.disabled = false;
    usernameInput.disabled = false;
    hostInput.disabled = false;
    portInput.disabled = false;
    console.error("Shell creation error:", error);
  }
}

async function disconnectShell() {
  if (isConnected) {
    isConnected = false;
    
    try {
      await invoke("async_terminate_shell");
    } catch (error) {
      console.error("Error terminating shell:", error);
    }
    
    statusText.textContent = "Disconnected";
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    usernameInput.disabled = false;
    hostInput.disabled = false;
    portInput.disabled = false;
  }
}


connectBtn.addEventListener("click", (e) => {
  e.preventDefault();
  connectShell();
});

disconnectBtn.addEventListener("click", (e) => {
  e.preventDefault();
  disconnectShell();
});

addEventListener("resize", fitTerminal);
fitTerminal();
void document.fonts.ready.then(fitTerminal);

term.onData((data: string) => {
  if (isConnected) {
    writeToPty(data);
  }
});

listen<string>("pty:data", (event) => {
  term.write(event.payload);
});

// Listen for PTY exit events
listen("pty:exit", async () => {
  term.writeln(`\r\n\x1b[33m✓ Shell exited\x1b[0m\r\n`);
  
  isConnected = false;
  statusText.textContent = "Disconnected";
  connectBtn.disabled = false;
  disconnectBtn.disabled = true;
  usernameInput.disabled = false;
  hostInput.disabled = false;
  portInput.disabled = false;
  await sleep(100);
  term.clear();
  idleTerminal();
});

// listen("pty:ready", () => {
//   statusText.textContent = "Shell is ready";
// });


function getCursorPixelPosition(term: Terminal) {
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