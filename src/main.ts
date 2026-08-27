import "@xterm/xterm/css/xterm.css";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/fira-code/400.css";
import "@fontsource/fira-code/500.css";

import { setupEventListeners } from "./events";
import {
  allPanes,
  closePaneMenu,
  createTab,
  getFocusedPane,
  setupWorkspace,
  tabs,
} from "./workspace";
import { closeDrawers, setupDrawers } from "./drawers";
import { setupCheatDrawer } from "./cheat/ui";
import { cheatsOrchestrator } from "./cheat/pencilgon";
import { applyScheme, currentScheme, schemes } from "./theme";
import { loadDefaultConnection } from "./shell";
import { defaultCheatState } from "./cheat/registry";
import { refreshChrome } from "./chrome";
import { DEBUG } from "./gadget";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { setupUpdater } from "./updater";

function setupWindowControls(): void {
  const appWindow = getCurrentWindow();
  document.querySelectorAll<HTMLButtonElement>("[data-window-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.windowAction;
      const operation = action === "minimize" ? appWindow.minimize() : action === "maximize" ? appWindow.toggleMaximize() : appWindow.close();
      void operation.catch(() => {});
    });
  });
  document.querySelectorAll<HTMLElement>("[data-window-drag-region]").forEach((region) => {
    region.addEventListener("pointerdown", () => void appWindow.startDragging().catch(() => {}));
  });
  document.querySelectorAll<HTMLElement>("[data-resize-direction]").forEach((handle) => {
    handle.addEventListener("pointerdown", () => {
      const direction = handle.dataset.resizeDirection as Parameters<typeof appWindow.startResizeDragging>[0];
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
    menu.querySelectorAll<HTMLButtonElement>(".scheme-option").forEach((option) => {
      option.classList.toggle("selected", option.dataset.scheme === slug);
      option.setAttribute("aria-selected", String(option.dataset.scheme === slug));
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
  applyScheme(currentScheme().slug);
  await setupEventListeners();
  setupWorkspace();
  setupDrawers();
  setupCheatDrawer();
  setupSchemePicker();
  setupWindowControls();
  setupUpdater();

  // First launch tab restores persisted defaults; nothing else is restored.
  createTab(loadDefaultConnection(), defaultCheatState(), true);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closePaneMenu();
      closeDrawers();
    }
  });

  void cheatsOrchestrator();
  refreshChrome();

  if (DEBUG) {
    const w = window as any;
    w.tabs = tabs;
    w.allPanes = allPanes;
    w.getFocusedPane = getFocusedPane;
  }
}

document.addEventListener("DOMContentLoaded", () => void main());
