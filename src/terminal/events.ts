import { listen } from "@tauri-apps/api/event";
import type {
  PtyDataPayload,
  PtyErrorPayload,
  PtyExitPayload,
  PtyLatencyPayload,
  PtyReadyPayload,
} from "../core/types";
import { panesBySession } from "./pane";
import { refreshChrome } from "../ui/chrome";
import {
  dispatchConnect,
  dispatchData,
  dispatchDisconnect,
} from "../cheat/pencilgon";
import { renderLatency } from "../ui/latency";

/** One global set of listeners; every event is routed by sessionId. */
export async function setupEventListeners(): Promise<void> {
  await listen<PtyReadyPayload>("pty:ready", (event) => {
    const pane = panesBySession.get(event.payload.sessionId);
    if (!pane) return;
    pane.setState("connected");
    pane.refitNow();
    refreshChrome();
    dispatchConnect(pane);
    renderLatency();
  });

  await listen<PtyDataPayload>("pty:data", (event) => {
    const pane = panesBySession.get(event.payload.sessionId);
    if (!pane) return;
    pane.term.write(event.payload.data);
    dispatchData(pane, event.payload.data);
  });

  await listen<PtyLatencyPayload>("pty:latency", (event) => {
    const pane = panesBySession.get(event.payload.sessionId);
    if (!pane) return;
    pane.latency = event.payload.rttMs;
    renderLatency();
  });

  await listen<PtyExitPayload>("pty:exit", (event) => {
    const pane = panesBySession.get(event.payload.sessionId);
    if (!pane) return;
    panesBySession.delete(event.payload.sessionId);
    pane.sessionId = null;
    pane.setState("disconnected");
    pane.showIdle();
    refreshChrome();
    dispatchDisconnect(pane);
    renderLatency();
  });

  await listen<PtyErrorPayload>("pty:error", (event) => {
    const pane = panesBySession.get(event.payload.sessionId);
    if (!pane) return;
    panesBySession.delete(event.payload.sessionId);
    pane.sessionId = null;
    pane.setState("disconnected");
    pane.term.writeln(
      "\r\n\x1b[31m\u2717 " + event.payload.message + "\x1b[0m\r\n",
    );
    refreshChrome();
    dispatchDisconnect(pane);
    renderLatency();
  });
}
