import type { Pane } from "../../terminal/pane";
import type { BridgeCallResult, BridgeCapabilityContext } from "../basicbridge";
import type { CheatCapabilityEntry } from "../basicbridge-registry";

export const sessions: Map<
  string,
  Record<string, string[]>
> = (typeof window !== "undefined" && (window as any).__NMAP_SESSIONS) ||
new Map();
if (typeof window !== "undefined") {
  (window as any).__NMAP_SESSIONS = sessions;
}

export function clearSessions(): void {
  sessions.clear();
}

export async function doPush(
  context: BridgeCapabilityContext<Pane>,
  arguments_: readonly string[],
): Promise<BridgeCallResult> {
  const callerId = context.runId;
  const key = arguments_[0] || "default";
  const buf = context.getCapture("buf");

  if (buf !== undefined) {
    let session = sessions.get(callerId);
    if (!session) {
      session = {};
      sessions.set(callerId, session);
    }
    if (!session[key]) {
      session[key] = [];
    }
    session[key].push(...buf);
  }

  return { ok: true };
}

export const doPushToBuffer = doPush;
export const runNmapPush = doPush;

export async function saveTextFile(
  content: string,
  defaultFilename = "nmap_scan.txt",
): Promise<void> {
  // 1. Native desktop file dialog via Tauri IPC (cross-platform: Linux, Windows, macOS)
  if (
    typeof window !== "undefined" &&
    Boolean((window as any).__TAURI_INTERNALS__)
  ) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const savedPath = await invoke<string | null>("save_file_dialog", {
        defaultName: defaultFilename,
        content,
      });
      if (savedPath) {
        console.log(`[nmap] Saved scan buffer to: ${savedPath}`);
      }
      return;
    } catch (err) {
      console.warn(
        "[nmap] Native save_file_dialog failed, falling back to web saver:",
        err,
      );
    }
  }

  // 2. Browser File System Access API (Chromium)
  if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: defaultFilename,
        types: [
          {
            description: "Text Files",
            accept: { "text/plain": [".txt"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return;
    } catch (err: any) {
      if (err?.name === "AbortError") {
        return;
      }
    }
  }

  // 3. Browser fallback via download anchor
  if (typeof document !== "undefined") {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = defaultFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

export async function doDone(
  context: BridgeCapabilityContext<Pane>,
  arguments_: readonly string[],
  saver: (
    content: string,
    filename: string,
  ) => Promise<void> | void = saveTextFile,
): Promise<BridgeCallResult> {
  const callerId = context.runId;
  const key = arguments_[0];
  const session = sessions.get(callerId);

  let content = "";
  if (key) {
    const collected = session?.[key] ?? [];
    console.log(`[nmap] Collected buffer of "${key}":`, collected);
    content = collected.join("\n");
  } else {
    console.log(
      `[nmap] Collected buffers for session "${callerId}":`,
      session ?? {},
    );
    if (session) {
      const entries = Object.entries(session);
      if (entries.length === 1) {
        content = entries[0][1].join("\n");
      } else {
        content = entries
          .map(([target, lines]) => `=== ${target} ===\n${lines.join("\n")}`)
          .join("\n\n");
      }
    }
  }

  const filename =
    arguments_[1] || (key ? `${key}.txt` : `${callerId || "nmap"}_scan.txt`);

  try {
    await saver(content, filename);
  } catch (err) {
    console.error("[nmap] Failed to save scan buffer to file:", err);
  }
  //clear the session after saving
  sessions.delete(callerId);

  return { ok: true };
}

export const entries: CheatCapabilityEntry[] = [
  { alias: "push", fn: doPushToBuffer },
  { alias: "done", fn: doDone },
];
