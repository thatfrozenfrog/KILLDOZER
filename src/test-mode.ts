import { invoke } from "@tauri-apps/api/core";

let _isTestServer = false;
let _isCheatEvaluationPaused = false;
const pauseListeners = new Set<(paused: boolean) => void>();

/**
 * Initializes test mode by querying the Tauri backend for `--test-server` CLI flag,
 * with fallback to `VITE_TEST_SERVER` environment variable or URL query parameter.
 */
export async function initTestMode(): Promise<boolean> {
  const envTestServer =
    import.meta.env.VITE_TEST_SERVER === "true" ||
    import.meta.env.VITE_TEST_SERVER === "1";

  try {
    const tauriTestServer = await invoke<boolean>("is_test_server");
    _isTestServer = Boolean(tauriTestServer) || envTestServer;
  } catch {
    _isTestServer = envTestServer;
  }

  return _isTestServer;
}

/** Synchronous check if test mode / mock test server is active. */
export function isTestServer(): boolean {
  return _isTestServer;
}

/** Alias for isTestServer. */
export function isTestMode(): boolean {
  return _isTestServer;
}

/** Check if cheat automation / evaluation loop is currently paused. */
export function isCheatEvaluationPaused(): boolean {
  return _isCheatEvaluationPaused;
}

/** Set the cheat evaluation pause state and notify listeners. */
export function setCheatEvaluationPaused(paused: boolean): void {
  if (_isCheatEvaluationPaused === paused) return;
  _isCheatEvaluationPaused = paused;
  for (const listener of pauseListeners) {
    listener(_isCheatEvaluationPaused);
  }
}

/** Toggle the cheat evaluation pause state. */
export function toggleCheatEvaluationPaused(): boolean {
  setCheatEvaluationPaused(!_isCheatEvaluationPaused);
  return _isCheatEvaluationPaused;
}

/** Subscribe to pause state changes. */
export function onCheatEvaluationPauseChange(
  listener: (paused: boolean) => void
): () => void {
  pauseListeners.add(listener);
  return () => pauseListeners.delete(listener);
}

/**
 * Sets up and renders the floating Test Mode overlay in the bottom-left corner
 * when test mode is active.
 */
export function setupTestModeOverlay(): void {
  const overlay = document.getElementById("test-mode-overlay");
  if (!overlay) return;

  if (!_isTestServer) {
    overlay.classList.add("hidden");
    return;
  }

  overlay.classList.remove("hidden");

  const toggleBtn = document.getElementById("test-mode-toggle") as HTMLButtonElement | null;
  const label = overlay.querySelector(".test-mode-label");

  const updateUI = (paused: boolean) => {
    if (!toggleBtn) return;
    toggleBtn.classList.toggle("paused", paused);
    toggleBtn.classList.toggle("active", !paused);
    toggleBtn.setAttribute("aria-pressed", String(paused));
    if (label) {
      label.textContent = paused ? "TEST MODE: PAUSED" : "TEST MODE: RUNNING";
    }
  };

  updateUI(_isCheatEvaluationPaused);

  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      toggleCheatEvaluationPaused();
    });
  }

  onCheatEvaluationPauseChange(updateUI);
}

