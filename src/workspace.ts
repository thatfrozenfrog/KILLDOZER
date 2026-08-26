import type {
  BranchNode,
  ConnectionConfig,
  LeafNode,
  SplitDirection,
  SplitNode,
  Tab,
} from "./types";
import { blankConnection, cloneConnection } from "./types";
import { SSH_HOST } from "./types";
import { Pane } from "./pane";
import { connectShell, disconnectShell, writeToPty } from "./shell";
import { cloneCheatState, defaultCheatState } from "./cheat/registry";
import type { CheatState } from "./cheat/registry";
import { refreshChrome } from "./chrome";
import { shouldConnectSplitChild } from "./workspace-logic";

export const MIN_PANE_WIDTH = 320;
export const MIN_PANE_HEIGHT = 200;

export const tabs: Tab[] = [];
let activeTab: Tab | null = null;

export function getActiveTab(): Tab | null {
  return activeTab;
}

export function getFocusedPane(): Pane | null {
  return activeTab?.focusedLeaf.pane ?? null;
}

export function* allPanes(): Generator<Pane> {
  for (const tab of tabs) {
    yield* walkPanes(tab.root);
  }
}

function* walkPanes(node: SplitNode): Generator<Pane> {
  if (node.kind === "leaf") {
    yield node.pane;
  } else {
    yield* walkPanes(node.a);
    yield* walkPanes(node.b);
  }
}

function* walkLeaves(node: SplitNode): Generator<LeafNode> {
  if (node.kind === "leaf") {
    yield node;
  } else {
    yield* walkLeaves(node.a);
    yield* walkLeaves(node.b);
  }
}

function firstLeaf(node: SplitNode): LeafNode {
  return node.kind === "leaf" ? node : firstLeaf(node.a);
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export function createTab(
  connection: ConnectionConfig = blankConnection(),
  cheats: CheatState = defaultCheatState(),
  isDefault = false
): Tab {
  const pane = new Pane(connection, cheats);
  pane.isDefault = isDefault;
  const leaf: LeafNode = { kind: "leaf", pane, parent: null };
  const pageEl = document.createElement("div");
  pageEl.className = "tab-page";
  const tab: Tab = { id: crypto.randomUUID(), root: leaf, focusedLeaf: leaf, pageEl };
  wireLeaf(tab, leaf);
  tabs.push(tab);
  workspaceEl().appendChild(pageEl);
  renderTab(tab);
  activateTab(tab);
  pane.showIdle();
  return tab;
}

export function activateTab(tab: Tab): void {
  activeTab = tab;
  for (const t of tabs) t.pageEl.classList.toggle("active", t === tab);
  renderTabBar();
  // page became visible: fit everything
  requestAnimationFrame(() => refitTab(tab));
  tab.focusedLeaf.pane.term.focus();
  refreshChrome();
}

export function closeTab(tab: Tab): void {
  for (const leaf of [...walkLeaves(tab.root)]) {
    void disconnectShell(leaf.pane);
    leaf.pane.dispose();
  }
  tab.pageEl.remove();
  const index = tabs.indexOf(tab);
  if (index >= 0) tabs.splice(index, 1);
  if (tabs.length === 0) {
    createTab();
  } else if (activeTab === tab) {
    activateTab(tabs[Math.max(0, index - 1)]);
  }
  refreshChrome();
}

// ---------------------------------------------------------------------------
// Split / close
// ---------------------------------------------------------------------------

/** Split a leaf. Returns the new pane, or null if the split was rejected
 *  (a resulting leaf would be smaller than 320x200 px). */
export function splitLeaf(tab: Tab, leaf: LeafNode, dir: SplitDirection): Pane | null {
  const rect = leaf.pane.el.getBoundingClientRect();
  if (dir === "row" && rect.width / 2 < MIN_PANE_WIDTH) return null;
  if (dir === "col" && rect.height / 2 < MIN_PANE_HEIGHT) return null;

  const child = new Pane(cloneConnection(leaf.pane.connection), cloneCheatState(leaf.pane.cheats));
  child.isDefault = leaf.pane.isDefault;
  const childLeaf: LeafNode = { kind: "leaf", pane: child, parent: null };
  const branch: BranchNode = {
    kind: "branch",
    dir,
    ratio: 0.5,
    a: leaf,
    b: childLeaf,
    parent: leaf.parent,
  };
  leaf.parent = branch;
  childLeaf.parent = branch;
  if (branch.parent) {
    if (branch.parent.a === leaf) branch.parent.a = branch;
    else branch.parent.b = branch;
  } else {
    tab.root = branch;
  }

  wireLeaf(tab, childLeaf);
  tab.focusedLeaf = childLeaf;
  renderTab(tab);
  child.term.focus();
  if (shouldConnectSplitChild(leaf.pane.state)) {
    void connectShell(child);
  } else {
    child.showIdle();
  }
  refreshChrome();
  return child;
}

export function closeLeaf(tab: Tab, leaf: LeafNode): void {
  void disconnectShell(leaf.pane);
  leaf.pane.dispose();

  const parent = leaf.parent;
  if (!parent) {
    closeTab(tab);
    return;
  }
  const sibling = parent.a === leaf ? parent.b : parent.a;
  sibling.parent = parent.parent;
  if (parent.parent) {
    if (parent.parent.a === parent) parent.parent.a = sibling;
    else parent.parent.b = sibling;
  } else {
    tab.root = sibling;
  }
  if (tab.focusedLeaf === leaf) {
    tab.focusedLeaf = firstLeaf(sibling);
    tab.focusedLeaf.pane.term.focus();
  }
  renderTab(tab);
  refreshChrome();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function workspaceEl(): HTMLElement {
  return document.getElementById("workspace") as HTMLElement;
}

function renderTab(tab: Tab): void {
  tab.pageEl.innerHTML = "";
  tab.pageEl.appendChild(renderNode(tab, tab.root));
  updateFocusVisuals();
  requestAnimationFrame(() => refitTab(tab));
}

function refitTab(tab: Tab): void {
  for (const leaf of walkLeaves(tab.root)) leaf.pane.refitNow();
}

function renderNode(tab: Tab, node: SplitNode): HTMLElement {
  if (node.kind === "leaf") return node.pane.el;

  const container = document.createElement("div");
  container.className = "split " + node.dir;
  const aEl = renderNode(tab, node.a);
  const bEl = renderNode(tab, node.b);
  const divider = makeDivider(tab, node, container);
  container.append(aEl, divider, bEl);
  applyRatio(container, node);
  return container;
}

function applyRatio(container: HTMLElement, branch: BranchNode): void {
  const [aEl, , bEl] = container.children as unknown as [HTMLElement, HTMLElement, HTMLElement];
  aEl.style.flex = branch.ratio + " 1 0%";
  bEl.style.flex = 1 - branch.ratio + " 1 0%";
}

function makeDivider(tab: Tab, branch: BranchNode, container: HTMLElement): HTMLElement {
  const divider = document.createElement("div");
  divider.className = "divider " + branch.dir;
  divider.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    divider.classList.add("dragging");
  });
  divider.addEventListener("pointermove", (e) => {
    if (!divider.hasPointerCapture(e.pointerId)) return;
    const rect = container.getBoundingClientRect();
    const horizontal = branch.dir === "row";
    const size = horizontal ? rect.width : rect.height;
    if (size <= 0) return;
    const pos = horizontal ? e.clientX - rect.left : e.clientY - rect.top;
    const min = (horizontal ? MIN_PANE_WIDTH : MIN_PANE_HEIGHT) / size;
    branch.ratio = Math.min(1 - min, Math.max(min, pos / size));
    applyRatio(container, branch);
  });
  const end = (e: PointerEvent) => {
    if (divider.hasPointerCapture(e.pointerId)) divider.releasePointerCapture(e.pointerId);
    divider.classList.remove("dragging");
    refitTab(tab);
  };
  divider.addEventListener("pointerup", end);
  divider.addEventListener("pointercancel", end);
  return divider;
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

export function renderTabBar(): void {
  const bar = document.getElementById("tab-bar");
  if (!bar) return;
  bar.innerHTML = "";
  for (const tab of tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (tab === activeTab ? " active" : "");
    const pane = tab.focusedLeaf.pane;
    const dot = document.createElement("span");
    dot.className = "pane-status-dot " + pane.state;
    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = pane.identity() + "@" + SSH_HOST;
    const close = document.createElement("button");
    close.className = "tab-close";
    close.textContent = "\u00D7";
    close.title = "Close tab";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(tab);
    });
    el.append(dot, label);
    if (pane.isDefault) {
      const badge = document.createElement("span");
      badge.className = "tab-default-badge";
      badge.textContent = "DEFAULT";
      badge.title = "Default profile — changes are saved";
      el.append(badge);
    }
    el.append(close);
    el.addEventListener("click", () => activateTab(tab));
    bar.appendChild(el);
  }
  const add = document.createElement("button");
  add.id = "new-tab";
  add.textContent = "+";
  add.title = "New tab";
  add.addEventListener("click", () => createTab());
  bar.appendChild(add);
}

// ---------------------------------------------------------------------------
// Per-leaf wiring: focus, toolbar actions, application right-click menu
// ---------------------------------------------------------------------------

function wireLeaf(tab: Tab, leaf: LeafNode): void {
  const el = leaf.pane.el;

  leaf.pane.term.onData((data) => writeToPty(leaf.pane, data));

  el.addEventListener("mousedown", (e) => {
    if (e.button === 2) {
      // Right-click always belongs to the app menu, never the remote session.
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    focusLeaf(tab, leaf);
  }, true);

  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    focusLeaf(tab, leaf);
    openPaneMenu(e.clientX, e.clientY, tab, leaf);
  });

  el.querySelector(".pane-toolbar")?.addEventListener("click", (e) => {
    const action = (e.target as HTMLElement).dataset?.action;
    if (!action) return;
    e.stopPropagation();
    focusLeaf(tab, leaf);
    if (action === "split-right") splitLeaf(tab, leaf, "row");
    else if (action === "split-down") splitLeaf(tab, leaf, "col");
    else if (action === "close") closeLeaf(tab, leaf);
    else if (action === "overflow") {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      openPaneMenu(rect.left, rect.bottom + 4, tab, leaf);
    }
  });
}

export function focusLeaf(tab: Tab, leaf: LeafNode): void {
  if (tab.focusedLeaf === leaf) return;
  tab.focusedLeaf = leaf;
  updateFocusVisuals();
  refreshChrome();
}

function updateFocusVisuals(): void {
  for (const tab of tabs) {
    for (const leaf of walkLeaves(tab.root)) {
      leaf.pane.el.classList.toggle("focused", tab === activeTab && leaf === tab.focusedLeaf);
    }
  }
}

// ---------------------------------------------------------------------------
// Pane context menu
// ---------------------------------------------------------------------------

let menuLeaf: { tab: Tab; leaf: LeafNode } | null = null;

function openPaneMenu(x: number, y: number, tab: Tab, leaf: LeafNode): void {
  const menu = document.getElementById("pane-menu");
  if (!menu) return;
  menuLeaf = { tab, leaf };
  menu.innerHTML = "";
  const pane = leaf.pane;
  const items: Array<[string, () => void] | null> = [
    [
      "Copy",
      () => {
        const text = pane.term.getSelection();
        if (text) void navigator.clipboard.writeText(text).catch(() => {});
      },
    ],
    [
      "Paste",
      () => {
        void navigator.clipboard
          .readText()
          .then((text) => {
            if (text) writeToPty(pane, text.replace(/\r?\n/g, "\r"));
          })
          .catch(() => {});
      },
    ],
    ["Select All", () => pane.term.selectAll()],
    ["Clear", () => pane.term.clear()],
    null,
    ["Split Right", () => splitLeaf(tab, leaf, "row")],
    ["Split Down", () => splitLeaf(tab, leaf, "col")],
    [
      pane.state === "disconnected" ? "Connect" : "Disconnect",
      () => {
        if (pane.state === "disconnected") void connectShell(pane);
        else void disconnectShell(pane);
      },
    ],
    ["Close Pane", () => closeLeaf(tab, leaf)],
  ];
  for (const entry of items) {
    if (!entry) {
      const sep = document.createElement("div");
      sep.className = "menu-sep";
      menu.appendChild(sep);
      continue;
    }
    const [label, fn] = entry;
    const item = document.createElement("button");
    item.className = "menu-item";
    item.textContent = label;
    item.addEventListener("click", () => {
      closePaneMenu();
      fn();
    });
    menu.appendChild(item);
  }
  menu.classList.remove("hidden");
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  menu.style.left = Math.min(x, window.innerWidth - mw - 8) + "px";
  menu.style.top = Math.min(y, window.innerHeight - mh - 8) + "px";
}

export function closePaneMenu(): void {
  document.getElementById("pane-menu")?.classList.add("hidden");
  menuLeaf = null;
}

export function setupWorkspace(): void {
  document.addEventListener("pointerdown", (e) => {
    const menu = document.getElementById("pane-menu");
    if (menu && !menu.contains(e.target as Node)) closePaneMenu();
  });
}
