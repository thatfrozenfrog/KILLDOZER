import { listen } from "@tauri-apps/api/event";
import { sleep } from './gadget';
import { getTerminal, fitTerminal, idleTerminal } from "./terminal";
import { setIsConnected } from "./shell";

const connectBtn = document.getElementById("connect-btn") as HTMLButtonElement;
const disconnectBtn = document.getElementById("disconnect-btn") as HTMLButtonElement;
const usernameInput = document.getElementById("username") as HTMLInputElement;
const proxyPortInput = document.getElementById("proxy-port") as HTMLInputElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;

let isConnected = true;

export async function setupEventListeners() {
  await listen("pty:ready", () => {
    toggleVisibility();
  });
  
  await listen<string>("pty:data", (event) => {
    const term = getTerminal();
    term.write(event.payload);
  });
  
  await listen("pty:exit", async () => {
    const term = getTerminal();
    await term.writeln(`\r\n\x1b[33m✓ Shell exited\x1b[0m\r\n`);
    
    setIsConnected(false);
    statusText.textContent = "Disconnected";
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    usernameInput.disabled = false;
    proxyPortInput.disabled = false;
    await sleep(100);
    term.clear();
    toggleVisibility();
    idleTerminal();
  });
}

export function setupResizeListener(isConnected: boolean) {
  addEventListener("resize", () => fitTerminal(isConnected));
}

function toggleVisibility(){
  const form = document.getElementById("connection-form");
  const banner = document.getElementsByClassName("ssh-title")[0] as HTMLElement;
  const cheat = document.getElementById("cheat");
  const mymy = document.getElementById("mymy-pointer");
  if (mymy) {
    mymy.style.display = isConnected ? "none" : "block";
  }
  if (!form || !banner || !cheat) return;
  
  if (isConnected) {
    form.style.display = "none";
    banner.style.display = "none";
    cheat.style.display = "block";
    isConnected = false;
  } else {
    form.style.display = "flex";
    banner.style.display = "block";
    // cheat.style.display = "none";
    isConnected = true;
  }
}