import { invoke } from "@tauri-apps/api/core";
import type { ConnectionConfig } from "./types";
import { SSH_HOST, SSH_PORT, blankConnection } from "./types";
import { Pane, panesBySession } from "./pane";
import { refreshChrome } from "./chrome";
import { isTestMode } from "./test-mode";

const STORAGE_KEY = "shell-settings";

/** Persisted proxy/default connection settings (legacy localStorage shape). */
export function loadDefaultConnection(): ConnectionConfig {
  const config = blankConnection();
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return config;
  try {
    const settings = JSON.parse(saved) as Partial<{
      proxyAddress: string;
      proxyPort: string;
      proxyAuthEnabled: boolean;
      proxyUsername: string;
      proxyPassword: string;
    }>;
    if (typeof settings.proxyAddress === "string") config.proxyAddress = settings.proxyAddress;
    if (typeof settings.proxyPort === "string") config.proxyPort = settings.proxyPort;
    if (typeof settings.proxyAuthEnabled === "boolean") config.proxyAuthEnabled = settings.proxyAuthEnabled;
    if (typeof settings.proxyUsername === "string") config.proxyUsername = settings.proxyUsername;
    if (typeof settings.proxyPassword === "string") config.proxyPassword = settings.proxyPassword;
  } catch (error) {
    console.error("Failed to load shell settings:", error);
  }
  return config;
}

/** Save proxy settings as defaults for future panes. The proxy password is
 *  stored in plaintext, matching the app's historical behavior. */
export function saveDefaultConnection(config: ConnectionConfig): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      proxyAddress: config.proxyAddress,
      proxyPort: config.proxyPort,
      proxyAuthEnabled: config.proxyAuthEnabled,
      proxyUsername: config.proxyUsername,
      proxyPassword: config.proxyPassword,
    })
  );
}

export function writeToPty(pane: Pane, data: string): void {
  if (isTestMode()) {
    if (data === "\r") {
      pane.term.write("\r\n");
    } else if (data === "\x7f" || data === "\b" || data === "\x08") {
      if (pane.term.buffer.active.cursorX > 0) {
        pane.term.write("\b \b");
      }
    } else {
      pane.term.write(data);
    }
    return;
  }
  if (pane.state === "connected" && pane.sessionId) {
    void invoke("async_write_to_pty", {
      sessionId: pane.sessionId,
      data,
    }).catch((e) => console.error("write failed:", e));
  }
}

export async function connectShell(pane: Pane): Promise<void> {
  if (pane.state !== "disconnected") return;

  if (isTestMode()) {
    const sessionId = crypto.randomUUID();
    pane.sessionId = sessionId;
    panesBySession.set(sessionId, pane);
    if (pane.isDefault) saveDefaultConnection(pane.connection);
    pane.setState("connected");
    pane.term.clear();
    pane.refitNow();
    refreshChrome();
    return;
  }

  pane.setState("connecting");
  pane.term.clear();

  const sessionId = crypto.randomUUID();
  pane.sessionId = sessionId;
  // Register before invoking: pty:ready may arrive before invoke resolves.
  panesBySession.set(sessionId, pane);
  if (pane.isDefault) saveDefaultConnection(pane.connection);
  refreshChrome();

  try {
    await invoke("async_create_shell", {
      sessionId,
      username: pane.identity(),
      host: SSH_HOST,
      port: SSH_PORT,
      proxyAddress: pane.connection.proxyAddress.trim(),
      proxyPort: pane.connection.proxyPort.trim(),
      proxyAuthEnabled: pane.connection.proxyAuthEnabled,
      proxyUsername: pane.connection.proxyUsername.trim(),
      proxyPassword: pane.connection.proxyAuthEnabled
        ? pane.connection.proxyPassword
        : "",
    });
  } catch (error) {
    panesBySession.delete(sessionId);
    pane.sessionId = null;
    pane.setState("disconnected");
    pane.term.writeln(
      "\r\n\x1b[31m\u2717 Failed to start shell: " + error + "\x1b[0m\r\n"
    );
  }
  refreshChrome();
}

export async function disconnectShell(pane: Pane): Promise<void> {
  const sessionId = pane.sessionId;
  if (!sessionId) return;
  panesBySession.delete(sessionId);
  pane.sessionId = null;
  pane.setState("disconnected");
  if (!isTestMode()) {
    try {
      await invoke("async_terminate_shell", { sessionId });
    } catch (error) {
      console.error("Error terminating shell:", error);
    }
  }
  pane.showIdle();
  refreshChrome();
}
