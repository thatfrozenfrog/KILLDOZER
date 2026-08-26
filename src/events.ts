import { listen } from "@tauri-apps/api/event";
import type {
  PtyDataPayload,
  PtyErrorPayload,
  PtyExitPayload,
  PtyReadyPayload,
} from "./types";
import { panesBySession } from "./pane";
import { refreshChrome } from "./chrome";

/** One global set of listeners; every event is routed by sessionId. */
export async function setupEventListeners(): Promise<void> {
  await listen<PtyReadyPayload>("pty:ready", (event) => {
    const pane = panesBySession.get(event.payload.sessionId);
    if (!pane) return;
    pane.setState("connected");
    pane.refitNow();
    refreshChrome();
  });

  await listen<PtyDataPayload>("pty:data", (event) => {
    panesBySession
      .get(event.payload.sessionId)
      ?.term.write(event.payload.data);
  });

  await listen<PtyExitPayload>("pty:exit", (event) => {
    const pane = panesBySession.get(event.payload.sessionId);
    if (!pane) return;
    panesBySession.delete(event.payload.sessionId);
    pane.sessionId = null;
    pane.setState("disconnected");
    pane.showIdle();
    refreshChrome();
  });

  await listen<PtyErrorPayload>("pty:error", (event) => {
    const pane = panesBySession.get(event.payload.sessionId);
    if (!pane) return;
    panesBySession.delete(event.payload.sessionId);
    pane.sessionId = null;
    pane.setState("disconnected");
    pane.term.writeln(
      "\r\n\x1b[31m\u2717 " + event.payload.message + "\x1b[0m\r\n"
    );
    refreshChrome();
  });
}
