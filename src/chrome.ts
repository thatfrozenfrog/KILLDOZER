type Listener = () => void;

const listeners: Listener[] = [];

export function onChromeChange(fn: Listener): void {
  listeners.push(fn);
}

export function refreshChrome(): void {
  for (const fn of listeners) fn();
}
