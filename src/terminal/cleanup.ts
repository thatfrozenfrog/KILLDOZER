export interface BusyPane {
  busy: boolean;
}

export function releasePaneBusy(pane: BusyPane): void {
  pane.busy = false;
}

export async function disconnectAllPanes<T extends BusyPane>(
  panes: Iterable<T>,
  disconnect: (pane: T) => Promise<void>,
): Promise<void> {
  await Promise.allSettled(
    Array.from(panes, async (pane) => {
      releasePaneBusy(pane);
      await disconnect(pane);
    }),
  );
}
