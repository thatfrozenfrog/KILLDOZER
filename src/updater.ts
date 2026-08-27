import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

let checking = false;

function showToast(message: string, kind: "success" | "error" = "success"): void {
  const toast = document.createElement("div");
  toast.className = `toast ${kind}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

async function checkForUpdates(button: HTMLButtonElement): Promise<void> {
  if (checking) return;
  checking = true;
  button.disabled = true;
  button.textContent = "Checking…";

  try {
    const update = await check();
    if (!update) {
      showToast("Already up to date");
      return;
    }

    const notes = update.body ? `\n\n${update.body}` : "";
    if (!window.confirm(`Killdozer ${update.version} is available. Install now?${notes}`)) return;

    button.textContent = "Downloading…";
    await update.downloadAndInstall(() => {
      button.textContent = "Installing…";
    });
    showToast("Update installed; restarting…");
    await relaunch();
  } catch (error) {
    console.error("Update check failed:", error);
    showToast("Update failed. Check the console for details.", "error");
  } finally {
    checking = false;
    button.disabled = false;
    button.textContent = "Check for updates";
  }
}

export function setupUpdater(): void {
  const button = document.getElementById("check-for-updates");
  if (!(button instanceof HTMLButtonElement)) return;
  button.addEventListener("click", () => void checkForUpdates(button));
}
