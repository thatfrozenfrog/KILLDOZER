import type { Pane } from "./pane";
import type { CheatState } from "./cheat/registry";

export const SSH_HOST = "telehack.com";
export const SSH_PORT = "2222";

export interface ConnectionConfig {
  username: string;
  proxyAddress: string;
  proxyPort: string;
  proxyAuthEnabled: boolean;
  proxyUsername: string;
  proxyPassword: string;
}

export type ConnectionState = "disconnected" | "connecting" | "connected";

export type SplitDirection = "row" | "col";

export interface LeafNode {
  kind: "leaf";
  pane: Pane;
  parent: BranchNode | null;
}

export interface BranchNode {
  kind: "branch";
  dir: SplitDirection;
  ratio: number;
  a: SplitNode;
  b: SplitNode;
  parent: BranchNode | null;
}

export type SplitNode = LeafNode | BranchNode;

export interface Tab {
  id: string;
  root: SplitNode;
  focusedLeaf: LeafNode;
  pageEl: HTMLElement;
}

export interface PtyReadyPayload {
  sessionId: string;
}
export interface PtyDataPayload {
  sessionId: string;
  data: string;
}
export interface PtyErrorPayload {
  sessionId: string;
  message: string;
}
export interface PtyExitPayload {
  sessionId: string;
}

export function blankConnection(): ConnectionConfig {
  return {
    username: "guest",
    proxyAddress: "",
    proxyPort: "",
    proxyAuthEnabled: false,
    proxyUsername: "",
    proxyPassword: "",
  };
}

export function cloneConnection(c: ConnectionConfig): ConnectionConfig {
  return { ...c };
}

export type { CheatState };
