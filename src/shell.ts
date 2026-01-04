import { invoke } from "@tauri-apps/api/tauri";
import { getTerminal, getTerminalElement, fitTerminal, idleTerminal } from "./terminal";

const usernameInput = document.getElementById("username") as HTMLInputElement;
const proxyPortInput = document.getElementById("proxy-port") as HTMLInputElement;
const connectBtn = document.getElementById("connect-btn") as HTMLButtonElement;
const disconnectBtn = document.getElementById("disconnect-btn") as HTMLButtonElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;

let isConnected = false;

export function getIsConnected() {
  return isConnected;
}

export function setIsConnected(state: boolean) {
  isConnected = state;
}

export function writeToPty(data: string) {
  if (isConnected) {
    void invoke("async_write_to_pty", {
      data,
    });
  }
}

export async function connectShell() {
  try {
    console.log("[DEBUG] connectShell called");
    const terminalElement = getTerminalElement();
    const img = terminalElement.querySelector("img");
    if (img) {
      terminalElement.removeChild(img);
    }
    const username = (usernameInput.value || "guest").trim() || "guest";
    const host = "telehack.com";
    const port = "2222";
    const proxyPort = (proxyPortInput.value || "").trim();
    
    console.log(`[DEBUG] Connecting: username=${username}, host=${host}, port=${port}, proxyPort=${proxyPort}`);
    
    statusText.textContent = "Starting shell...";
    connectBtn.disabled = true;
    disconnectBtn.disabled = false;
    usernameInput.disabled = true;
    proxyPortInput.disabled = true;

    const term = getTerminal();
    term.clear();
    
    console.log("[DEBUG] Invoking async_create_shell...");
    await invoke("async_create_shell", { username, host, port, proxyPort });
    
    console.log("[DEBUG] Shell created successfully");
    isConnected = true;
    statusText.textContent = "Connected as" + ` ${username}@${host}:${port}`;
    
    await fitTerminal(isConnected);
    term.focus();

  } catch (error) {
    console.error("[DEBUG] Shell creation error:", error);
    statusText.textContent = `Failed to start shell: ${error}`;
    connectBtn.disabled = false;
    disconnectBtn.disabled = false;
    usernameInput.disabled = false;
    proxyPortInput.disabled = false;
  }
}

export async function disconnectShell() {
  if (isConnected) {
    isConnected = false;
    
    try {
      await invoke("async_terminate_shell");
    } catch (error) {
      console.error("Error terminating shell:", error);
    }
    
    idleTerminal();
    statusText.textContent = "Disconnected";
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    usernameInput.disabled = false;
    proxyPortInput.disabled = false;
  }
}

export function setupShellEventListeners() {
  connectBtn.addEventListener("click", (e) => {
    e.preventDefault();
    connectShell();
  });

  disconnectBtn.addEventListener("click", (e) => {
    e.preventDefault();
    disconnectShell();
  });
}
