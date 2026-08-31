import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { confirmDialog } from "./drawers";

let checking = false;

function showToast(message: string, kind: "success" | "error" = "success"): void {
  const toast = document.createElement("div");
  toast.className = `toast ${kind}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function setOutdated(outdated: boolean): void {
  document.getElementById("app-outdated")?.classList.toggle("hidden", !outdated);
}

async function checkForUpdates(button: HTMLButtonElement): Promise<void> {
  if (checking) return;
  checking = true;
  button.disabled = true;
  button.textContent = "Checking…";

  try {
    const update = await check({
      headers: {
        Accept: "application/octet-stream",
      },
    });
    if (!update) {
      setOutdated(false);
      showToast("Already up to date");
      return;
    }

    setOutdated(true);
    const notes = update.body ? `\n\n${update.body}` : "";
    const confirmed = await confirmDialog(
      `Killdozer ${update.version} is available. Install now?${notes}`,
      "Update Available",
      "Install"
    );
    if (!confirmed) return;

    button.textContent = "Downloading…";
    let downloaded = 0;
    let total = 0;
    await update.downloadAndInstall(
      (event) => {
        if (event.event === "Started" && event.data.contentLength) {
          total = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total > 0) {
            const pct = Math.round((downloaded / total) * 100);
            button.textContent = `Downloading ${pct}%…`;
          }
        } else if (event.event === "Finished") {
          button.textContent = "Installing…";
        }
      },
      {
        headers: {
          Accept: "application/octet-stream",
        },
      }
    );
    showToast("Update installed; restarting…");
    await relaunch();
  } catch (error) {
    console.error("Update check failed:", error);
    const msg = error instanceof Error ? error.message : String(error);
    showToast(`Update error: ${msg}`, "error");
  } finally {
    checking = false;
    button.disabled = false;
    button.textContent = "Check for updates";
  }
}

export function setupUpdater(): void {
  const versionEl = document.getElementById("app-version");
  if (versionEl) versionEl.textContent = typeof __VERSION__ !== "undefined" ? `v${__VERSION__}` : "";

  void check({
    headers: {
      Accept: "application/octet-stream",
    },
  })
    .then((update) => {
      if (update) setOutdated(true);
    })
    .catch((err) => {
      console.warn("Background update check skipped:", err);
    });

  const button = document.getElementById("check-for-updates");
  if (!(button instanceof HTMLButtonElement)) return;
  button.addEventListener("click", () => void checkForUpdates(button));
}
