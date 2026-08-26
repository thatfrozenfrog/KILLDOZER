import { getFocusedPane } from "./workspace";
import { connectShell, disconnectShell, saveDefaultConnection } from "./shell";
import { onChromeChange, refreshChrome } from "./chrome";
import type { Pane } from "./pane";

let boundPane: Pane | null = null;

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export function closeDrawers(): void {
  document.getElementById("connection-drawer")?.classList.remove("open");
  document.getElementById("cheats-drawer")?.classList.remove("open");
}

export function toggleDrawer(id: string): void {
  const drawer = document.getElementById(id);
  if (!drawer) return;
  const wasOpen = drawer.classList.contains("open");
  closeDrawers();
  if (!wasOpen) drawer.classList.add("open");
}

export function setupDrawers(): void {
  el("toggle-connection").addEventListener("click", () => toggleDrawer("connection-drawer"));
  el("toggle-cheats").addEventListener("click", () => toggleDrawer("cheats-drawer"));

  const username = el<HTMLInputElement>("username");
  const proxyIp = el<HTMLInputElement>("proxy-ip");
  const proxyPort = el<HTMLInputElement>("proxy-port");
  const proxyAuthEnabled = el<HTMLInputElement>("proxy-auth-enabled");
  const proxyAuthFields = el<HTMLDivElement>("proxy-auth-fields");
  const proxyUsername = el<HTMLInputElement>("proxy-username");
  const proxyPassword = el<HTMLInputElement>("proxy-password");
  const connectBtn = el<HTMLButtonElement>("connect-btn");
  const disconnectBtn = el<HTMLButtonElement>("disconnect-btn");
  const statusText = el<HTMLSpanElement>("status-text");

  const edit = (fn: (pane: Pane) => void) => () => {
    const pane = getFocusedPane();
    if (!pane) return;
    fn(pane);
    if (pane.isDefault) saveDefaultConnection(pane.connection);
    refreshChrome();
  };

  username.addEventListener("input", edit((p) => (p.connection.username = username.value)));
  proxyIp.addEventListener("input", edit((p) => (p.connection.proxyAddress = proxyIp.value)));
  proxyPort.addEventListener("input", edit((p) => (p.connection.proxyPort = proxyPort.value)));
  proxyUsername.addEventListener("input", edit((p) => (p.connection.proxyUsername = proxyUsername.value)));
  proxyPassword.addEventListener("input", edit((p) => (p.connection.proxyPassword = proxyPassword.value)));
  proxyAuthEnabled.addEventListener("change", edit((p) => {
    p.connection.proxyAuthEnabled = proxyAuthEnabled.checked;
    proxyAuthFields.classList.toggle("hidden", !proxyAuthEnabled.checked);
  }));

  connectBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const pane = getFocusedPane();
    if (pane) void connectShell(pane);
  });
  disconnectBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const pane = getFocusedPane();
    if (pane) void disconnectShell(pane);
  });

  onChromeChange(() => {
    const pane = getFocusedPane();
    const busy = pane?.state !== "disconnected";

    if (pane && pane !== boundPane) {
      boundPane = pane;
      username.value = pane.connection.username;
      proxyIp.value = pane.connection.proxyAddress;
      proxyPort.value = pane.connection.proxyPort;
      proxyAuthEnabled.checked = pane.connection.proxyAuthEnabled;
      proxyUsername.value = pane.connection.proxyUsername;
      proxyPassword.value = pane.connection.proxyPassword;
      proxyAuthFields.classList.toggle("hidden", !pane.connection.proxyAuthEnabled);
    }

    username.disabled = busy;
    proxyIp.disabled = busy;
    proxyPort.disabled = busy;
    proxyAuthEnabled.disabled = busy;
    proxyUsername.disabled = busy || !proxyAuthEnabled.checked;
    proxyPassword.disabled = busy || !proxyAuthEnabled.checked;

    connectBtn.disabled = !pane || pane.state !== "disconnected";
    disconnectBtn.disabled = !pane || pane.state === "disconnected";

    if (!pane) statusText.textContent = "No pane";
    else if (pane.state === "connected") statusText.textContent = "Connected \u2014 " + pane.identity() + "@telehack.com:2222";
    else if (pane.state === "connecting") statusText.textContent = "Connecting\u2026";
    else statusText.textContent = "Disconnected";
  });
}
