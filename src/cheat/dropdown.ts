export interface DropdownOption {
  value: string;
  text: string;
}

/** Base24 listbox replacement for a native select. */
export class CustomDropdown {
  private options: DropdownOption[] = [];
  private selected = "";
  private handler: ((value: string) => void) | null = null;

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
      const item = document.createElement("button");
      item.type = "button";
      item.className = "dropdown-option";
      item.role = "option";
      item.dataset.value = option.value;
      item.textContent = option.text;
      item.addEventListener("click", () => this.select(option.value));
      this.menu.appendChild(item);
    });
    this.sync();
  }

  onSelect(handler: (value: string) => void): void {
    this.handler = handler;
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
