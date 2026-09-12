export function createWindowShutdown(
  disconnectAll: () => Promise<void>,
  destroyWindow: () => Promise<void>,
): () => Promise<void> {
  let shutdown: Promise<void> | undefined;

  return () => {
    shutdown ??= (async () => {
      await disconnectAll();
      await destroyWindow();
    })();
    return shutdown;
  };
}
