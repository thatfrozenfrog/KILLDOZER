import { listen } from "@tauri-apps/api/event";
import { sleep } from './gadget';
import { getTerminal, fitTerminal, idleTerminal } from "./terminal";
import { getIsConnected, setIsConnected } from "./shell";

const connectBtn = document.getElementById("connect-btn") as HTMLButtonElement;
const disconnectBtn = document.getElementById("disconnect-btn") as HTMLButtonElement;
const usernameInput = document.getElementById("username") as HTMLInputElement;
const proxyPortInput = document.getElementById("proxy-port") as HTMLInputElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;

export async function setupEventListeners() {
  await listen("pty:ready", () => {
    setIsConnected(true);
    syncConnectionUi();
  });
  
  await listen<string>("pty:data", (event) => {
    const term = getTerminal();
    term.write(event.payload);
  });
  
  await listen("pty:exit", async () => {
    const term = getTerminal();
    await term.writeln(`\r\n\x1b[33m✓ Shell exited\x1b[0m\r\n`);
    
    setIsConnected(false);
    syncConnectionUi();
    statusText.textContent = "Disconnected";
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    usernameInput.disabled = false;
    proxyPortInput.disabled = false;
    await sleep(100);
    term.clear();
    idleTerminal();
  });
}

export function setupResizeListener(isConnected: boolean) {
  addEventListener("resize", () => fitTerminal(isConnected));
}

export function syncConnectionUi(){
  const form = document.getElementById("connection-form");
  const banner = document.getElementsByClassName("ssh-title")[0] as HTMLElement;
  const cheat = document.getElementById("cheat");
  const mymy = document.getElementById("mymy-pointer");
  const connected = getIsConnected();

  if (mymy) {
    mymy.style.display = connected ? "none" : "block";
  }
  if (!form || !banner || !cheat) return;
  
  if (connected) {
    form.style.display = "none";
    banner.style.display = "none";
    cheat.style.display = "block";
  } else {
    form.style.display = "flex";
    banner.style.display = "block";
    cheat.style.display = "none";
  }
}