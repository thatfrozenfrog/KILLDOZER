import { getFocusedPane } from "./workspace";
import { onChromeChange } from "./chrome";

export function renderLatency(): void {
  const container = document.getElementById("latency-indicator");
  const valueEl = document.getElementById("latency-value");
  if (!container || !valueEl) return;

  const pane = getFocusedPane();
  if (!pane || pane.state !== "connected") {
    container.classList.add("hidden");
    container.classList.remove("good", "medium", "poor");
    return;
  }

  container.classList.remove("hidden");
  container.classList.remove("good", "medium", "poor");
  const ms = pane.latency;

  if (ms === null) {
    valueEl.textContent = "...";
    container.title = "Measuring latency...";
    return;
  }

  valueEl.textContent = `${ms} ms`;
  container.title = `Latency (RTT): ${ms} ms`;

  if (ms < 120) {
    container.classList.add("good");
  } else if (ms <= 300) {
    container.classList.add("medium");
  } else {
    container.classList.add("poor");
  }
}

export function setupLatencyMonitoring(): void {
  onChromeChange(() => renderLatency());
}
