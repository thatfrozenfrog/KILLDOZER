const listeners = new Set<() => void>();
export const onChromeChange = (fn: () => void): void => {
  listeners.add(fn);
};
export const refreshChrome = (): void => {
  for (const fn of listeners) fn();
};
