export type ConfigType = "input" | "label" | "checker" | "radio" | "slider";

export interface ConfigOption {
  type: ConfigType;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  value?: string | number | boolean;
}
/**
 * A cheat inside a category.
 * @example
 * ```ts
 * new Cheat("Porthack", "Auto port guessing / autoporting.", [
 *      { type: "slider", label: "Speed", min: 1, max: 100, value: 50 },
 *    ]),
 */
export class Cheat {
  name: string;
  description: string;
  /**
   * Optional array of configs for this cheat. Each config can be of type input, label, checker, radio, or slider.
   */
  config?: ConfigOption[];
  enabled: boolean = false;

  constructor(name: string, description: string, config?: ConfigOption[]) {
    this.name = name; 
    this.description = description;
    this.config = config;
  }

  getConfigByLabel(label: string): ConfigOption | undefined {
    return this.config?.find(
      (cfg) => cfg.label.toLowerCase() === label.toLowerCase()
    );
  }

  getValue(label: string): any {
    return this.getConfigByLabel(label)?.value;
  }
}

export type CheatState = Record<string, Cheat[]>;

function builtinCheats(): CheatState {
  return {
    Automation: [
      new Cheat("Autovon", "Auto parse and decode autovon.exe dialup sequence."),
      new Cheat("Porthack", "Auto port guessing / autoporting.", [
        { type: "slider", label: "Speed", min: 1, max: 100, value: 50 },
      ]),
      new Cheat("Satan", "Auto parse satan.exe memdump output."),
      new Cheat("Autologin", "Auto login as guest / user.", [
        { type: "input", label: "Username", value: "guest" },
        { type: "input", label: "Password", value: "" },
        { type: "checker", label: "As Guest?", value: true },
      ]),
    ],
    Game: [
      new Cheat("Sudoku", "Auto solve sudoku puzzles.", [
        { type: "slider", label: "Speed", min: 1, max: 100, value: 50 },
      ]),
      new Cheat("2048", "Auto play 2048.", [
        {
          type: "radio",
          label: "Strategy",
          options: ["Conservative", "Aggressive", "Random"],
          value: "Conservative",
        },
      ]),
      new Cheat("Typespeed", "Auto play typespeed.", [
        { type: "slider", label: "WPM", min: 10, max: 200, value: 60 },
      ]),
    ],
  };
}

const STORAGE_KEY = "cheat-settings";

function serialize(state: CheatState): Record<string, any> {
  const settings: Record<string, any> = {};
  Object.keys(state).forEach((cat) => {
    settings[cat] = state[cat].map((cheat) => ({
      name: cheat.name,
      enabled: cheat.enabled,
      config: cheat.config?.map((cfg) => ({ label: cfg.label, value: cfg.value })),
    }));
  });
  return settings;
}

function applySaved(state: CheatState, saved: any): void {
  Object.keys(state).forEach((cat) => {
    const savedCheats = saved[cat] || [];
    state[cat].forEach((cheat) => {
      const savedCheat = savedCheats.find((c: any) => c.name === cheat.name);
      if (!savedCheat) return;
      cheat.enabled = Boolean(savedCheat.enabled);
      if (savedCheat.config && cheat.config) {
        savedCheat.config.forEach((cfg: any) => {
          const item = cheat.config!.find((c) => c.label === cfg.label);
          if (item) item.value = cfg.value;
        });
      }
    });
  });
}

/** Fresh default cheat state: built-ins with persisted defaults applied. */
export function defaultCheatState(): CheatState {
  const state = builtinCheats();
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      applySaved(state, JSON.parse(saved));
    } catch (e) {
      console.error("Failed to load cheat settings:", e);
    }
  }
  return state;
}

/** Deep-clone a pane's cheat state so edits never leak across panes. */
export function cloneCheatState(state: CheatState): CheatState {
  const clone: CheatState = {};
  for (const cat of Object.keys(state)) {
    clone[cat] = state[cat].map(
      (cheat) =>
        new Cheat(
          cheat.name,
          cheat.description,
          cheat.config?.map((cfg) => ({ ...cfg }))
        )
    );
    clone[cat].forEach((cheat, i) => (cheat.enabled = state[cat][i].enabled));
  }
  return clone;
}

/** Persist a cheat state as the defaults handed to future panes. */
export function saveDefaultCheats(state: CheatState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize(state)));
}

export function countActive(state: CheatState): number {
  return Object.values(state).flat().filter((c) => c.enabled).length;
}
