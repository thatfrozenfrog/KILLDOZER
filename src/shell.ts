import { invoke } from "@tauri-apps/api/tauri";
import { getTerminal, getTerminalElement, fitTerminal, idleTerminal } from "./terminal";

const usernameInput = document.getElementById("username") as HTMLInputElement;
const hostInput = document.getElementById("host") as HTMLInputElement;
const portInput = document.getElementById("port") as HTMLInputElement;
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
    const terminalElement = getTerminalElement();
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

    const term = getTerminal();
    term.clear();
    await invoke("async_create_shell", { username, host, port });
    
    isConnected = true;
    statusText.textContent = "Connected as" + ` ${username}@${host}:${port}`;
    
    await fitTerminal(isConnected);
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

export async function disconnectShell() {
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
