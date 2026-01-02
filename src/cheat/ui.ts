import "../css/cheat.css";
type ConfigType = "input" | "label" | "checker" | "radio" | "slider";

interface ConfigOption {
  type: ConfigType;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  defaultValue?: string | number | boolean;
}

class Cheat {
  name: string;
  description: string;
  config?: ConfigOption[];

  constructor(name: string, description: string, config?: ConfigOption[]) {
    this.name = name;
    this.description = description;
    this.config = config;
  }
}

const hack: Record<string, Cheat[]> = {
  Automation: [
    new Cheat("Autovon", "Auto parse and decode autovon.exe dialup sequence."),
    new Cheat("Porthack", "Auto port guessing / autoporting.", [
      { type: "slider", label: "Speed", min: 1, max: 100, defaultValue: 50 }
    ]),
    new Cheat("Satan", "Auto parse satan.exe memdump output."),
    new Cheat("Autologin", "Auto login as guest / user.", [
      { type: "input", label: "Username", defaultValue: "guest" },
      { type: "checker", label: "Remember password", defaultValue: false }
    ])
  ],
  Game: [
    new Cheat("Sudoku", "Auto solve sudoku puzzles.", [
      { type: "slider", label: "Speed", min: 1, max: 100, defaultValue: 50 }
    ]),
    new Cheat("2048", "Auto play 2048.", [
      { type: "radio", label: "Strategy", options: ["Conservative", "Aggressive", "Random"], defaultValue: "Conservative" }
    ]),
    new Cheat("Typespeed", "Auto play typespeed.", [
      { type: "slider", label: "WPM", min: 10, max: 200, defaultValue: 60 }
    ])
  ]
}

const list = document.getElementById("cheat-list");
const search = document.getElementById("search") as HTMLInputElement;
if (!list){
  throw new Error("Cheat list element not found");
}
if (!search){
  throw new Error("Search input element not found");
}
function fuzzyMatch(text: string, query:string):boolean{
  const pattern = query.split('').map(c => c.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('.*?');
  const regex = new RegExp(pattern, 'i');
  return regex.test(text);
}


function render(category: Record<string, Cheat[]> | string): void {
  if (!list) {
    throw new Error("Cheat list element not found");
  }
  list.innerHTML = "";

  Object.keys(hack)
    .sort()
    .forEach(cat => {
      const catRow = document.createElement("div");
      catRow.className = "list-row category";
      catRow.textContent = cat;

      const content = document.createElement("div");
      content.className = "category-content hidden";

      catRow.onclick = () => {
        content.classList.toggle("hidden");
      };

      hack[cat]
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((cheat, index, array) => {
          const cheatContainer = document.createElement("div");
          cheatContainer.className = index === array.length - 1 ? "cheat-container last" : "cheat-container";

          const row = document.createElement("div");
          row.className = "list-row cheat";
          
          const cheatName = document.createElement("span");
          cheatName.className = "cheat-name";
          cheatName.textContent = cheat.name;
          row.appendChild(cheatName);

          let arrow: HTMLSpanElement | undefined;
          let config: HTMLDivElement | undefined;

          if (cheat.config && cheat.config.length > 0) {
            arrow = document.createElement("span");
            arrow.textContent = "▼";
            arrow.className = "arrow";
            row.appendChild(arrow);

            config = document.createElement("div");
            config.className = "config hidden";

            cheat.config.forEach(cfg => {
              const configItem = createConfigElement(cfg);
              config!.appendChild(configItem);
            });

            arrow.onclick = e => {
              e.stopPropagation();
              config!.classList.toggle("hidden");
              arrow!.classList.toggle("expanded");
            };
          }

          row.onclick = () => {
            row.classList.toggle("active");
          };

          cheatContainer.appendChild(row);
          if (config) cheatContainer.appendChild(config);
          content.appendChild(cheatContainer);
        });

      list.appendChild(catRow);
      list.appendChild(content);
    });
}

function createConfigElement(config: ConfigOption): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "config-item";

  const label = document.createElement("label");
  label.textContent = config.label;

  switch (config.type) {
    case "input":
      const input = document.createElement("input");
      input.type = "text";
      input.value = (config.defaultValue as string) || "";
      label.appendChild(input);
      break;

    case "slider":
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = (config.min ?? 0).toString();
      slider.max = (config.max ?? 100).toString();
      slider.step = (config.step ?? 1).toString();
      slider.value = (config.defaultValue as string) || "50";
      const valueDisplay = document.createElement("span");
      valueDisplay.textContent = slider.value;
      slider.oninput = () => {
        valueDisplay.textContent = slider.value;
      };
      label.appendChild(slider);
      label.appendChild(valueDisplay);
      break;

    case "checker":
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = (config.defaultValue as boolean) || false;
      label.appendChild(checkbox);
      break;

    case "radio":
      const radioGroup = document.createElement("div");
      radioGroup.className = "radio-group";
      (config.options || []).forEach(option => {
        const radioWrapper = document.createElement("label");
        radioWrapper.className = "radio-label";
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = config.label;
        radio.value = option;
        radio.checked = option === config.defaultValue;
        radioWrapper.appendChild(radio);
        radioWrapper.appendChild(document.createTextNode(option));
        radioGroup.appendChild(radioWrapper);
      });
      label.appendChild(radioGroup);
      break;

    case "label":
      const span = document.createElement("span");
      span.textContent = (config.defaultValue as string) || "";
      label.appendChild(span);
      break;
  }

  wrapper.appendChild(label);
  return wrapper;
}

function renderSearch(query: string): void {
  if (!list) {
    throw new Error("Cheat list element not found");
  }
  list.innerHTML = "";
  
  const cheats: Array<{ cat: string; cheat: Cheat }> = [];
  for (const cat in hack) {
    for (const cheat of hack[cat]) {
      if (fuzzyMatch(cheat.name, query) || fuzzyMatch(cheat.description, query)) {
        cheats.push({ cat, cheat });
      }
    }
  }
  
  cheats.sort((a, b) => a.cheat.name.localeCompare(b.cheat.name));
  
  for (const item of cheats) {
    const cheatContainer = document.createElement("div");
    cheatContainer.className = "cheat-container search-result";

    const categoryLabel = document.createElement("div");
    categoryLabel.className = "category-label";
    categoryLabel.textContent = item.cat;
    
    const row = document.createElement("div");
    row.className = "list-row cheat";
    
    const cheatName = document.createElement("span");
    cheatName.className = "cheat-name";
    cheatName.textContent = item.cheat.name;
    row.appendChild(cheatName);

    let arrow: HTMLSpanElement | undefined;
    let config: HTMLDivElement | undefined;

    if (item.cheat.config && item.cheat.config.length > 0) {
      arrow = document.createElement("span");
      arrow.textContent = "▼";
      arrow.className = "arrow";
      row.appendChild(arrow);

      config = document.createElement("div");
      config.className = "config hidden";

      item.cheat.config.forEach(cfg => {
        const configItem = createConfigElement(cfg);
        config!.appendChild(configItem);
      });

      arrow.onclick = e => {
        e.stopPropagation();
        config!.classList.toggle("hidden");
        arrow!.classList.toggle("expanded");
      };
    }

    row.onclick = () => {
      row.classList.toggle("active");
    };

    cheatContainer.appendChild(categoryLabel);
    cheatContainer.appendChild(row);
    if (config) cheatContainer.appendChild(config);
    list.appendChild(cheatContainer);
  }
}

search.addEventListener("input", e => {
  const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
  if (q === ""){
    render(hack);
  } else {
    renderSearch(q);
  }
});

render(hack);