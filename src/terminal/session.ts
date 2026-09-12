export interface SessionPane {
  sessionId: string | null;
  sessionGeneration: number;
  state: string;
  busy: boolean;
}

/** Begins a connection attempt: increments generation and returns new generation token and session ID */
export function beginSessionAttempt(
  pane: SessionPane,
  sessionId = crypto.randomUUID(),
): {
  generation: number;
  sessionId: string;
} {
  const generation = ++pane.sessionGeneration;
  pane.sessionId = sessionId;
  pane.state = "connecting";
  return { generation, sessionId };
}

/** Fails a connection attempt: only resets pane if the generation matches attemptGeneration */
export function failSessionAttempt(
  pane: SessionPane,
  attemptGeneration: number,
  onRollback?: () => void,
): boolean {
  if (pane.sessionGeneration === attemptGeneration) {
    pane.sessionId = null;
    pane.state = "disconnected";
    onRollback?.();
    return true;
  }
  return false;
}

/** Terminates / disconnects session and increments generation to invalidate active loops */
export function terminateSession(
  pane: SessionPane,
  onCleanup?: () => void,
): void {
  pane.sessionGeneration++;
  pane.busy = false;
  pane.sessionId = null;
  pane.state = "disconnected";
  onCleanup?.();
}

/** Checks whether a session generation token is still current for this pane */
export function isSessionCurrent(
  pane: { sessionGeneration: number },
  generation?: number,
): boolean {
  if (generation === undefined) return true;
  return pane.sessionGeneration === generation;
}
