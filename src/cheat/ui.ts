import type { Pane } from "../pane";
import { getFocusedPane } from "../workspace";
import { onChromeChange } from "../chrome";
import {
  Cheat,
  ConfigOption,
  countActive,
  saveDefaultCheats,
} from "./registry";
import { filterCheats, type CheatFilters } from "./filter";
import { CustomDropdown } from "./dropdown";

let renderedPane: Pane | null = null;
let configuring: Cheat | null = null;
let categoryDropdown: CustomDropdown | null = null;
const filters: CheatFilters = { query: "", category: "", status: "all" };
const DRAWER_WIDTH_KEY = "cheats-drawer-width";
const MIN_DRAWER_WIDTH = 320;
const MAX_DRAWER_WIDTH = 720;

function list(): HTMLElement {
  return document.getElementById("cheat-list") as HTMLElement;
}

function updateActiveCount(pane: Pane): void {
  const el = document.getElementById("active-count");
  if (el) el.textContent = countActive(pane.cheats) + " active";
}

function showToast(message: string): void {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

function persist(pane: Pane): void {
  if (pane.isDefault) saveDefaultCheats(pane.cheats);
}

function buildCheatCard(pane: Pane, cheat: Cheat): HTMLElement {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "cheat-card";
  card.title = cheat.description;
  card.setAttribute("aria-pressed", String(cheat.enabled));
  if (cheat.enabled) card.classList.add("active");
  if (configuring === cheat) card.classList.add("configuring");

  const name = document.createElement("span");
  name.className = "cheat-name";
  name.textContent = cheat.name;
  const action = document.createElement("span");
  action.className = "cheat-action";
  action.textContent = cheat.enabled ? "Enabled" : "Disabled";
  card.append(name, action);

  card.addEventListener("click", () => {
    cheat.enabled = !cheat.enabled;
    showToast(cheat.name + (cheat.enabled ? " enabled" : " disabled"));
    persist(pane);
    render(pane);
  });
  card.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (!cheat.config?.length) return;
    configuring = configuring === cheat ? null : cheat;
    render(pane);
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      if (!cheat.config?.length) return;
      configuring = cheat;
      render(pane);
    }
  });
  return card;
}

function createConfigElement(pane: Pane, config: ConfigOption): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "config-item";
  const label = document.createElement("label");
  label.textContent = config.label;
  const save = () => persist(pane);

  switch (config.type) {
    case "input": {
      const input = document.createElement("input");
      input.type = config.label === "Password" ? "password" : "text";
      input.value = (config.value as string) || "";
      input.oninput = () => {
        config.value = input.value;
        save();
      };
      label.appendChild(input);
      break;
    }
    case "slider": {
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = (config.min ?? 0).toString();
      slider.max = (config.max ?? 100).toString();
      slider.step = (config.step ?? 1).toString();
      slider.value = String(config.value ?? config.min ?? 0);

      const number = document.createElement("input");
      number.type = "number";
      number.min = slider.min;
      number.max = slider.max;
      number.step = slider.step;
      number.value = slider.value;

      slider.oninput = () => {
        number.value = slider.value;
        config.value = Number(slider.value);
        save();
      };
      number.onchange = () => {
        let v = Number(number.value);
        const min = Number(slider.min), max = Number(slider.max);
        if (isNaN(v)) v = min;
        v = Math.min(max, Math.max(min, v));
        number.value = slider.value = String(v);
        config.value = v;
        save();
      };
      label.append(slider, number);
      break;
    }
    case "checker": {
      const line = document.createElement("div");
      line.className = "switchline";
      const text = document.createElement("span");
      text.textContent = config.label;
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "config-switch";
      toggle.setAttribute("role", "switch");
      toggle.setAttribute("aria-label", config.label);
      const on = Boolean(config.value);
      toggle.classList.toggle("on", on);
      toggle.setAttribute("aria-checked", String(on));
      toggle.addEventListener("click", () => {
        const next = !Boolean(config.value);
        config.value = next;
        toggle.classList.toggle("on", next);
        toggle.setAttribute("aria-checked", String(next));
        save();
      });
      line.append(text, toggle);
      wrapper.appendChild(line);
      return wrapper;
    }
    case "radio": {
      const group = document.createElement("div");
      group.className = "radio-group";
      (config.options || []).forEach((option) => {
        const radioLabel = document.createElement("label");
        radioLabel.className = "radio-label";
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = config.label + "-" + pane.id;
        radio.value = option;
        radio.checked = option === config.value;
        radio.onchange = () => {
          config.value = option;
          save();
        };
        radioLabel.append(radio, document.createTextNode(option));
        group.appendChild(radioLabel);
      });
      label.appendChild(group);
      break;
    }
    case "label": {
      const span = document.createElement("span");
      span.textContent = (config.value as string) || "";
      label.appendChild(span);
      break;
    }
  }

  wrapper.appendChild(label);
  return wrapper;
}

function render(pane: Pane): void {
  const root = list();
  root.innerHTML = "";
  updateCategoryFilter(pane);
  const found = filterCheats(pane.cheats, filters);
  updateActiveCount(pane);
  if (!found.length) {
    const empty = document.createElement("div");
    empty.className = "search-empty";
    empty.textContent = "No cheats match these filters.";
    root.appendChild(empty);
    return;
  }

  const layout = document.createElement("div");
  layout.className = "cheat-layout";
  const matrix = document.createElement("div");
  matrix.className = "cheat-matrix";
  for (const category of [...new Set(found.map((item) => item.category))]) {
    const group = document.createElement("section");
    group.className = "cheat-group";
    const heading = document.createElement("h2");
    heading.textContent = category;
    const grid = document.createElement("div");
    grid.className = "cheat-grid";
    const groupCheats = found.filter((item) => item.category === category);
    groupCheats.forEach(({ cheat }) => grid.appendChild(buildCheatCard(pane, cheat)));
    group.append(heading, grid);
    matrix.appendChild(group);
  }

  const configured = Object.entries(pane.cheats).find(([, cheats]) =>
    cheats.some((cheat) => cheat === configuring)
  );
  if (configured && configuring?.config?.length) {
    const inspector = document.createElement("aside");
    inspector.className = "cheat-inspector";
    inspector.appendChild(buildConfigPanel(pane, configured[0], configuring));
    layout.classList.add("with-inspector");
    layout.append(matrix, inspector);
  } else {
    layout.appendChild(matrix);
  }
  root.appendChild(layout);
}

function buildConfigPanel(pane: Pane, category: string, cheat: Cheat): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "cheat-config-panel";
  const header = document.createElement("div");
  header.className = "cheat-config-header";
  const details = document.createElement("div");
  const eyebrow = document.createElement("div");
  eyebrow.className = "cheat-config-eyebrow";
  eyebrow.textContent = category + " · " + (cheat.enabled ? "Enabled" : "Disabled");
  const title = document.createElement("h3");
  title.textContent = cheat.name;
  const description = document.createElement("p");
  description.className = "cheat-config-description";
  description.textContent = cheat.description;
  const status = document.createElement("span");
  status.className = "cheat-config-status";
  status.textContent = cheat.enabled ? "ON" : "OFF";
  status.classList.toggle("enabled", cheat.enabled);
  details.append(eyebrow, title, description, status);
  // const close = document.createElement("button");
  // close.type = "button";
  // close.className = "cheat-config-close";
  // close.textContent = "Close";
  // close.addEventListener("click", () => {
  //   configuring = null;
  //   render(pane);
  // });
  header.append(details);//, close);
  panel.append(header);
  cheat.config?.forEach((config) => {
    const section = document.createElement("section");
    section.className = "cheat-config-section";
    section.appendChild(createConfigElement(pane, config));
    panel.appendChild(section);
  });
  return panel;
}

function updateCategoryFilter(pane: Pane): void {
  if (!categoryDropdown) return;
  const categories = Object.keys(pane.cheats).sort();
  if (!categories.includes(filters.category)) filters.category = "";
  categoryDropdown.setOptions(
    [{ value: "", text: "All categories" }, ...categories.map((category) => ({ value: category, text: category }))],
    filters.category
  );
}

export function setupCheatDrawer(): void {
  setupDrawerResize();
  const search = document.getElementById("search") as HTMLInputElement;
  search.addEventListener("input", () => {
    const pane = getFocusedPane();
    if (!pane) return;
    filters.query = search.value;
    render(pane);
  });
  categoryDropdown = new CustomDropdown(
    document.getElementById("cheat-category-filter") as HTMLButtonElement,
    document.getElementById("cheat-category-menu") as HTMLElement
  );
  categoryDropdown.onSelect((value) => {
    filters.category = value;
    const pane = getFocusedPane();
    if (pane) render(pane);
  });

  const statusDropdown = new CustomDropdown(
    document.getElementById("cheat-status-filter") as HTMLButtonElement,
    document.getElementById("cheat-status-menu") as HTMLElement
  );
  statusDropdown.onSelect((value) => {
    filters.status = value as CheatFilters["status"];
    const pane = getFocusedPane();
    if (!pane) return;
    render(pane);
  });
  statusDropdown.setOptions(
    [
      { value: "all", text: "All states" },
      { value: "enabled", text: "Enabled" },
      { value: "disabled", text: "Disabled" },
    ],
    filters.status
  );

  onChromeChange(() => {
    const pane = getFocusedPane();
    if (!pane || pane === renderedPane) return;
    renderedPane = pane;
    configuring = null;
    render(pane);
  });
}

function setupDrawerResize(): void {
  const drawer = document.getElementById("cheats-drawer");
  const handle = document.getElementById("cheats-drawer-resize");
  if (!drawer || !handle) return;

  const clamp = (width: number) => Math.min(MAX_DRAWER_WIDTH, Math.max(MIN_DRAWER_WIDTH, width));
  const applyWidth = (width: number) => {
    const value = clamp(width);
    drawer.style.setProperty("--cheat-drawer-width", `${value}px`);
    sessionStorage.setItem(DRAWER_WIDTH_KEY, String(value));
  };
  const saved = Number(sessionStorage.getItem(DRAWER_WIDTH_KEY));
  applyWidth(Number.isFinite(saved) && saved > 0 ? saved : 430);

  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    drawer.classList.add("resizing");
    const move = (moveEvent: PointerEvent) => applyWidth(window.innerWidth - moveEvent.clientX);
    const stop = () => {
      drawer.classList.remove("resizing");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  });
  handle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const current = drawer.getBoundingClientRect().width;
    applyWidth(current + (event.key === "ArrowLeft" ? 24 : -24));
  });
}
