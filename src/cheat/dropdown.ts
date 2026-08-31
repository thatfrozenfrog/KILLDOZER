export interface DropdownOption {
  value: string;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}
/** Base24 listbox replacement for a native select. */
export class CustomDropdown {
  private options: DropdownOption[] = [];
  private selected = "";
  private handler: ((value: string) => void) | null = null;
  private previewHandler: ((value: string) => void) | null = null;

  constructor(
    private readonly button: HTMLButtonElement,
    private readonly menu: HTMLElement
  ) {
    button.addEventListener("click", () => this.toggle());
    button.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.close();
    });
    document.addEventListener("pointerdown", (event) => {
      if (!button.contains(event.target as Node) && !menu.contains(event.target as Node)) {
        this.close();
      }
    });
  }

  setOptions(options: DropdownOption[], selected: string): void {
    this.options = options;
    this.selected = selected;
    this.menu.replaceChildren();
    options.forEach((option) => {
      const row = document.createElement("div");
      row.className = "dropdown-option-row";
      const item = document.createElement("button");
      item.type = "button";
      item.className = "dropdown-option";
      item.role = "option";
      item.dataset.value = option.value;
      item.textContent = option.text;
      item.addEventListener("click", () => this.select(option.value));
      item.addEventListener("pointerenter", () => this.previewHandler?.(option.value));
      item.addEventListener("focus", () => this.previewHandler?.(option.value));
      row.appendChild(item);
      if (option.onAction) {
        const action = document.createElement("button");
        action.type = "button";
        action.className = "dropdown-option-action";
        action.textContent = "💾";//"▣";
        action.title = option.actionLabel ?? "Save current configuration";
        action.setAttribute("aria-label", action.title);
        action.addEventListener("click", (event) => {
          event.stopPropagation();
          option.onAction?.();
        });
        row.appendChild(action);
      }
      this.menu.appendChild(row);
    });
    this.sync();
  }

  onSelect(handler: (value: string) => void): void {
    this.handler = handler;
  }

  onPreview(handler: (value: string) => void): void {
    this.previewHandler = handler;
  }

  get value(): string {
    return this.selected;
  }

  private select(value: string): void {
    this.selected = value;
    this.sync();
    this.close();
    if (this.handler) this.handler(value);
  }

  private sync(): void {
    const option = this.options.find((item) => item.value === this.selected);
    this.button.textContent = option ? option.text : this.options[0]?.text ?? "";
    this.menu.querySelectorAll<HTMLButtonElement>(".dropdown-option").forEach((item) => {
      const on = item.dataset.value === this.selected;
      item.classList.toggle("selected", on);
      item.setAttribute("aria-selected", String(on));
    });
  }

  private toggle(): void {
    if (this.menu.classList.contains("hidden")) this.open();
    else this.close();
  }

  private open(): void {
    this.menu.classList.remove("hidden");
    this.button.setAttribute("aria-expanded", "true");
  }

  private close(): void {
    this.menu.classList.add("hidden");
    this.button.setAttribute("aria-expanded", "false");
  }
}
