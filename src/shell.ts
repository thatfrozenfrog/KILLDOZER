import { invoke } from "@tauri-apps/api/tauri";
import { getTerminal, getTerminalElement, fitTerminal, idleTerminal } from "./terminal";
import { syncConnectionUi } from "./events";

const usernameInput = document.getElementById("username") as HTMLInputElement;
const proxyPortInput = document.getElementById("proxy-port") as HTMLInputElement;
const proxyIpInput = document.getElementById("proxy-ip") as HTMLInputElement;
const proxyAuthEnabledInput = document.getElementById("proxy-auth-enabled") as HTMLInputElement;
const proxyAuthFields = document.getElementById("proxy-auth-fields") as HTMLDivElement;
const proxyUsernameInput = document.getElementById("proxy-username") as HTMLInputElement;
const proxyPasswordInput = document.getElementById("proxy-password") as HTMLInputElement;
const connectBtn = document.getElementById("connect-btn") as HTMLButtonElement;
const disconnectBtn = document.getElementById("disconnect-btn") as HTMLButtonElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;
const STORAGE_KEY = "shell-settings";

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

function setProxyAuthFieldsVisible(visible: boolean) {
  if (proxyAuthFields) {
    proxyAuthFields.classList.toggle("hidden", !visible);
  }
}

function setProxyAuthInputsDisabled(disabled: boolean) {
  if (proxyAuthEnabledInput) proxyAuthEnabledInput.disabled = disabled;
  if (proxyUsernameInput) proxyUsernameInput.disabled = disabled || !proxyAuthEnabledInput.checked;
  if (proxyPasswordInput) proxyPasswordInput.disabled = disabled || !proxyAuthEnabledInput.checked;
}

function syncProxyAuthUi() {
  const enabled = Boolean(proxyAuthEnabledInput?.checked);
  setProxyAuthFieldsVisible(enabled);
}

function saveShellSettings(): void {
  const settings = {
    proxyAddress: proxyIpInput?.value || "",
    proxyPort: proxyPortInput?.value || "",
    proxyAuthEnabled: Boolean(proxyAuthEnabledInput?.checked),
    proxyUsername: proxyUsernameInput?.value || "",
    proxyPassword: proxyPasswordInput?.value || "",
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function loadShellSettings(): void {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return;

  try {
    const settings = JSON.parse(saved) as {
      proxyAddress?: string;
      proxyPort?: string;
      proxyAuthEnabled?: boolean;
      proxyUsername?: string;
      proxyPassword?: string;
    };

    if (proxyIpInput && typeof settings.proxyAddress === "string") proxyIpInput.value = settings.proxyAddress;
    if (proxyPortInput && typeof settings.proxyPort === "string") proxyPortInput.value = settings.proxyPort;
    if (proxyAuthEnabledInput && typeof settings.proxyAuthEnabled === "boolean") proxyAuthEnabledInput.checked = settings.proxyAuthEnabled;
    if (proxyUsernameInput && typeof settings.proxyUsername === "string") proxyUsernameInput.value = settings.proxyUsername;
    if (proxyPasswordInput && typeof settings.proxyPassword === "string") proxyPasswordInput.value = settings.proxyPassword;
  } catch (error) {
    console.error("Failed to load shell settings:", error);
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
    const proxyAddress = (proxyIpInput?.value || "").trim();
    const proxyAuthEnabled = Boolean(proxyAuthEnabledInput?.checked);
    const proxyUsername = (proxyUsernameInput?.value || "").trim();
    const proxyPassword = proxyAuthEnabled ? (proxyPasswordInput?.value || "") : "";

    console.log(`[DEBUG] Connecting: username=${username}, host=${host}, port=${port}, proxyAddress=${proxyAddress}, proxyPort=${proxyPort}, proxyAuthEnabled=${proxyAuthEnabled}`);

    statusText.textContent = "Starting shell...";
    connectBtn.disabled = true;
    disconnectBtn.disabled = false;
    usernameInput.disabled = true;
    proxyPortInput.disabled = true;
    if (proxyIpInput) proxyIpInput.disabled = true;
    setProxyAuthInputsDisabled(true);
    saveShellSettings();

    const term = getTerminal();
    term.clear();

    console.log("[DEBUG] Invoking async_create_shell...");
    await invoke("async_create_shell", {
      username,
      host,
      port,
      proxyAddress,
      proxyPort,
      proxyAuthEnabled,
      proxyUsername,
      proxyPassword,
    });

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
    if (proxyIpInput) proxyIpInput.disabled = false;
    setProxyAuthInputsDisabled(false);
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

    syncConnectionUi();
    idleTerminal();
    statusText.textContent = "Disconnected";
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    usernameInput.disabled = false;
    proxyPortInput.disabled = false;
    if (proxyIpInput) proxyIpInput.disabled = false;
    setProxyAuthInputsDisabled(false);
  }
}

export function setupShellEventListeners() {
  loadShellSettings();
  syncProxyAuthUi();
  if (proxyAuthEnabledInput) {
    proxyAuthEnabledInput.addEventListener("change", () => {
      syncProxyAuthUi();
      setProxyAuthInputsDisabled(false);
      saveShellSettings();
    });
  }

  if (proxyIpInput) proxyIpInput.addEventListener("input", saveShellSettings);
  if (proxyPortInput) proxyPortInput.addEventListener("input", saveShellSettings);
  if (proxyUsernameInput) proxyUsernameInput.addEventListener("input", saveShellSettings);
  if (proxyPasswordInput) proxyPasswordInput.addEventListener("input", saveShellSettings);

  connectBtn.addEventListener("click", (e) => {
    e.preventDefault();
    connectShell();
  });

  disconnectBtn.addEventListener("click", (e) => {
    e.preventDefault();
    disconnectShell();
  });
}
