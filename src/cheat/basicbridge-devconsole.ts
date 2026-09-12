import type { BridgeSnapshot, BasicBridgeRuntime } from "./basicbridge.ts";

export interface BasicBridgeDevConsole {
  version: 1;
  panes(): Array<{
    paneId: string;
    connected: boolean;
    bridgeEnabled: boolean;
  }>;
  snapshot(paneId?: string): BridgeSnapshot;
  captures(paneId?: string): Record<string, string[]>;
  capture(name: string, paneId?: string): string[] | undefined;
  capabilities(): string[];
  feed(data: string, paneId?: string): void;
  reset(paneId?: string): void;
}

export interface BasicBridgeDevConsoleOptions<PaneType extends { id: string }> {
  runtime: BasicBridgeRuntime<PaneType>;
  allPanes(): Iterable<PaneType>;
  focusedPane(): PaneType | null;
  capabilityIds(): Iterable<string>;
  isConnected(pane: PaneType): boolean;
  isBridgeEnabled(pane: PaneType): boolean;
}

export function createBasicBridgeDevConsole<PaneType extends { id: string }>(
  options: BasicBridgeDevConsoleOptions<PaneType>,
): BasicBridgeDevConsole {
  const resolvePane = (paneId?: string): PaneType => {
    if (!paneId) {
      const pane = options.focusedPane();
      if (!pane) throw new Error("No focused pane");
      return pane;
    }
    const pane = [...options.allPanes()].find(
      (candidate) => candidate.id === paneId,
    );
    if (!pane) throw new Error(`Unknown pane: ${paneId}`);
    return pane;
  };

  return {
    version: 1,
    panes: () =>
      [...options.allPanes()].map((pane) => ({
        paneId: pane.id,
        connected: options.isConnected(pane),
        bridgeEnabled: options.isBridgeEnabled(pane),
      })),
    snapshot: (paneId) => options.runtime.snapshot(resolvePane(paneId)),
    captures: (paneId) =>
      Object.fromEntries(
        [...options.runtime.snapshot(resolvePane(paneId)).captures].map(
          ([name, lines]) => [name, [...lines]],
        ),
      ),
    capture: (name, paneId) => {
      const lines = options.runtime.getCapture(resolvePane(paneId), name);
      return lines ? [...lines] : undefined;
    },
    capabilities: () => [...options.capabilityIds()],
    feed: (data, paneId) => options.runtime.ingest(resolvePane(paneId), data),
    reset: (paneId) => options.runtime.reset(resolvePane(paneId), "devconsole"),
  };
}
