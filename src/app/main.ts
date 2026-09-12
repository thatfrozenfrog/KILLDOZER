import "@xterm/xterm/css/xterm.css";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/fira-code/400.css";
import "@fontsource/fira-code/500.css";

import { setupEventListeners } from "../terminal/events";
import {
  allPanes,
  closePaneMenu,
  createTab,
  getFocusedPane,
  setupWorkspace,
  tabs,
} from "../terminal/workspace";
import { closeDrawers, setupDrawers } from "../ui/drawers";
import { setupCheatDrawer } from "../cheat/ui";
import * as pencilgon from "../cheat/pencilgon";
import * as stdin from "../cheat/input";
import * as stdout from "../cheat/output";
import { setupBasicBridge } from "../cheat/basicbridge-app";
import { applyScheme, currentScheme, schemes } from "../ui/theme";
import { disconnectShell, loadDefaultConnection } from "../terminal/shell";
import { disconnectAllPanes } from "../terminal/cleanup";
import { defaultCheatState } from "../cheat/registry";
import { refreshChrome } from "../ui/chrome";
import { DEBUG } from "../core/gadget";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { setupUpdater } from "../ui/updater";
import { initTestMode, setupTestModeOverlay } from "../core/test-mode";
import { initDozer } from "../dozer/dozer";
import { setupLatencyMonitoring } from "../ui/latency";
import { createWindowShutdown } from "./window-shutdown";

async function setupWindowControls(): Promise<void> {
  const appWindow = getCurrentWindow();
  const closeWindow = createWindowShutdown(
    () => disconnectAllPanes(allPanes(), disconnectShell),
    () => appWindow.destroy(),
  );

  await appWindow.onCloseRequested(async (event) => {
    event.preventDefault();
    await closeWindow();
  });

  document
    .querySelectorAll<HTMLButtonElement>("[data-window-action]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.windowAction;
        const operation =
          action === "minimize"
            ? appWindow.minimize()
            : action === "maximize"
              ? appWindow.toggleMaximize()
              : closeWindow();
        void operation.catch(() => {});
      });
    });
  document
    .querySelectorAll<HTMLElement>("[data-resize-direction]")
    .forEach((handle) => {
      handle.addEventListener("pointerdown", () => {
        const direction = handle.dataset.resizeDirection as Parameters<
          typeof appWindow.startResizeDragging
        >[0];
        void appWindow.startResizeDragging(direction).catch(() => {});
      });
    });
}

function setupSchemePicker(): void {
  const picker = document.getElementById("scheme-picker") as HTMLButtonElement;
  const menu = document.getElementById("scheme-menu") as HTMLDivElement;
  const control = picker.parentElement as HTMLDivElement;

  const closeMenu = () => {
    menu.classList.add("hidden");
    picker.setAttribute("aria-expanded", "false");
  };
  const selectScheme = (slug: string) => {
    applyScheme(slug);
    for (const pane of allPanes()) pane.applyTheme();
    picker.textContent = currentScheme().name;
    menu
      .querySelectorAll<HTMLButtonElement>(".scheme-option")
      .forEach((option) => {
        option.classList.toggle("selected", option.dataset.scheme === slug);
        option.setAttribute(
          "aria-selected",
          String(option.dataset.scheme === slug),
        );
      });
    closeMenu();
  };

  for (const scheme of schemes) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "scheme-option";
    option.dataset.scheme = scheme.slug;
    option.role = "option";
    option.textContent = scheme.name;
    option.addEventListener("click", () => selectScheme(scheme.slug));
    menu.appendChild(option);
  }
  selectScheme(currentScheme().slug);

  picker.addEventListener("click", () => {
    const open = menu.classList.toggle("hidden");
    picker.setAttribute("aria-expanded", String(!open));
  });
  document.addEventListener("pointerdown", (event) => {
    if (!control.contains(event.target as Node)) closeMenu();
  });
  picker.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
}

async function main(): Promise<void> {
  await initTestMode();
  setupBasicBridge();
  applyScheme(currentScheme().slug);
  await setupEventListeners();
  setupWorkspace();
  setupDrawers();
  setupCheatDrawer();
  setupSchemePicker();
  await setupWindowControls();
  setupUpdater();
  setupTestModeOverlay();
  initDozer();
  setupLatencyMonitoring();

  // First launch tab restores persisted defaults; nothing else is restored.
  createTab(loadDefaultConnection(), defaultCheatState(), true);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closePaneMenu();
      closeDrawers();
    }
  });

  void pencilgon.cheatsOrchestrator();
  refreshChrome();

  if (DEBUG) {
    const w = window as any;
    w.tabs = tabs;
    w.allPanes = allPanes;
    w.getFocusedPane = getFocusedPane;
    Object.defineProperty(w, "pane", {
      get: getFocusedPane,
      configurable: true,
    });
    w.stdin = stdin;
    w.stdout = stdout;
    w.pencilgon = pencilgon;
    w.send = (data: string) => {
      const pane = getFocusedPane();
      return pane ? stdin.send(pane, data) : undefined;
    };
    w.type = (data: string, opt?: any) => {
      const pane = getFocusedPane();
      return pane ? stdin.type(pane, data, opt) : undefined;
    };
    w.line = () => {
      const pane = getFocusedPane();
      return pane ? stdout.getCurrentLine(pane) : "";
    };
    w.th_exec = (command: string, opt?: any) => {
      const pane = getFocusedPane();
      return pane ? stdin.th_exec(pane, command, opt) : undefined;
    };
    w.reloadCheats = pencilgon.reloadCheatModules;
    w.reloadCheatModules = pencilgon.reloadCheatModules;
  }
}

document.addEventListener("DOMContentLoaded", () => void main());
