export class AutologinPromptState<PaneType extends object, Kind> {
  private readonly handled = new WeakMap<PaneType, Map<Kind, string>>();

  claim(pane: PaneType, kind: Kind, key: string): boolean {
    if (this.handled.get(pane)?.get(kind) === key) return false;
    this.mark(pane, kind, key);
    return true;
  }

  mark(pane: PaneType, kind: Kind, key: string): void {
    let prompts = this.handled.get(pane);
    if (!prompts) {
      prompts = new Map();
      this.handled.set(pane, prompts);
    }
    prompts.set(kind, key);
  }

  retain(pane: PaneType, activeKinds: Iterable<Kind>): void {
    const prompts = this.handled.get(pane);
    if (!prompts) return;

    const active = new Set(activeKinds);
    for (const kind of prompts.keys()) {
      if (!active.has(kind)) prompts.delete(kind);
    }
    if (prompts.size === 0) this.handled.delete(pane);
  }

  clear(pane: PaneType): void {
    this.handled.delete(pane);
  }
}
