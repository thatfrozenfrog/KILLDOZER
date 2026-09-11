import * as stdout from "../../output";
import * as stdin from "../../input";
import type { Pane } from "../../../pane";
import type { Cheat } from "../../registry";
import { sleep } from "../../../gadget";

export type MoveDirection = "Left" | "Right" | "Up" | "Down";
const MOVES: MoveDirection[] = ["Left", "Right", "Up", "Down"];

// Track timestamp of last executed keystroke per pane
const lastMoveTime = new Map<string, number>();
// Track last board state hash to avoid redundant keypresses on static boards
const lastBoardHash = new Map<string, string>();

// ---------------------------------------------------------------------------
// 1. Terminal Board Parser
// ---------------------------------------------------------------------------

/**
 * Parses the 4x4 grid from Telehack terminal lines.
 *
 * Matches ASCII box grids where rows are enclosed in:
 * +-------+-------+-------+-------+
 * |       |       |       |       |
 * |     2 |       |       |       |
 * |       |       |       |       |
 * +-------+-------+-------+-------+
 */
export function parse2048Board(lines: string[]): number[][] | null {
  const sepIndices: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.includes("+") && trimmed.includes("-")) {
      const plusCount = (trimmed.match(/\+/g) || []).length;
      if (plusCount >= 5) {
        sepIndices.push(i);
      }
    }
  }

  // Look for 5 consecutive boundary dividers enclosing 4 cell rows
  for (let s = 0; s <= sepIndices.length - 5; s++) {
    const dividers = sepIndices.slice(s, s + 5);
    let valid = true;
    for (let d = 0; d < 4; d++) {
      const rowLinesCount = dividers[d + 1] - dividers[d] - 1;
      if (rowLinesCount < 1 || rowLinesCount > 5) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;

    const grid: number[][] = [];
    for (let r = 0; r < 4; r++) {
      const start = dividers[r] + 1;
      const end = dividers[r + 1];
      const rowLines = lines.slice(start, end);

      const cols = [0, 0, 0, 0];
      for (const line of rowLines) {
        const firstPipe = line.indexOf("|");
        const lastPipe = line.lastIndexOf("|");
        if (firstPipe === -1 || lastPipe === -1 || firstPipe === lastPipe)
          continue;

        const content = line.substring(firstPipe + 1, lastPipe);
        const cells = content.split("|");
        if (cells.length === 4) {
          for (let c = 0; c < 4; c++) {
            const num = parseInt(cells[c].trim(), 10);
            if (!Number.isNaN(num) && num > 0) {
              cols[c] = num;
            }
          }
        }
      }
      grid.push(cols);
    }

    return grid;
  }

  return null;
}

// ---------------------------------------------------------------------------
// 2. 2048 Board State & Move Simulation
// ---------------------------------------------------------------------------

const WEIGHT_MAP = [
  [16, 32, 64, 128],
  [64, 128, 256, 512],
  [256, 512, 1024, 4096],
  [65536, 16384, 4096, 1024],
];
const EMPTY_FACTOR = 2.5;
const SMOOTH_FACTOR = 0.1;
const WEIGHT_FACTOR = 1.0;

export class Board {
  grid: number[][];

  constructor(grid?: number[][]) {
    this.grid = grid
      ? grid.map((row) => [...row])
      : Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  }

  clone(): Board {
    return new Board(this.grid);
  }

  equals(b: Board): boolean {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        if (this.grid[i][j] !== b.grid[i][j]) return false;
      }
    }
    return true;
  }

  transpose(): void {
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const tmp = this.grid[i][j];
        this.grid[i][j] = this.grid[j][i];
        this.grid[j][i] = tmp;
      }
    }
  }

  reverse(): void {
    for (let i = 0; i < 4; i++) {
      this.grid[i].reverse();
    }
  }

  moveLeft(): void {
    for (let r = 0; r < 4; r++) {
      const nonZero = this.grid[r].filter((v) => v !== 0);
      const merged: number[] = [];
      let i = 0;
      while (i < nonZero.length) {
        if (i + 1 < nonZero.length && nonZero[i] === nonZero[i + 1]) {
          merged.push(nonZero[i] * 2);
          i += 2;
        } else {
          merged.push(nonZero[i]);
          i++;
        }
      }
      while (merged.length < 4) merged.push(0);
      this.grid[r] = merged;
    }
  }

  lose(): boolean {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        if (this.grid[i][j] === 0) return false;
        if (j + 1 < 4 && this.grid[i][j] === this.grid[i][j + 1]) return false;
        if (i + 1 < 4 && this.grid[i][j] === this.grid[i + 1][j]) return false;
      }
    }
    return true;
  }
}

export function mover(b: Board, dir: number): Board {
  const next = b.clone();
  switch (dir) {
    case 0: // Left
      next.moveLeft();
      break;
    case 1: // Right
      next.reverse();
      next.moveLeft();
      next.reverse();
      break;
    case 2: // Up
      next.transpose();
      next.moveLeft();
      next.transpose();
      break;
    case 3: // Down
      next.transpose();
      next.reverse();
      next.moveLeft();
      next.reverse();
      next.transpose();
      break;
  }
  return next;
}

// ---------------------------------------------------------------------------
// 3. 64-Bit Board Encoding & Transposition Table
// ---------------------------------------------------------------------------

/** Packs 4x4 grid into a single 64-bit integer (4 bits per tile log2) */
export function boardToBitKey(b: Board): bigint {
  let key = 0n;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const val = b.grid[r][c];
      const log2 = val <= 0 ? 0n : BigInt(31 - Math.clz32(val));
      key = (key << 4n) | (log2 & 0xfn);
    }
  }
  return key;
}

interface TTEntry {
  depth: number;
  score: number;
}

// ---------------------------------------------------------------------------
// 4. Evaluation Heuristics & Expectimax Solver
// ---------------------------------------------------------------------------

export function evaluate(b: Board): number {
  let empty = 0;
  let monoScore = 0;
  let smoothScore = 0;

  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const val = b.grid[i][j];
      if (val === 0) {
        empty++;
      } else {
        monoScore += val * WEIGHT_MAP[i][j];
        if (j + 1 < 4 && b.grid[i][j + 1] !== 0) {
          smoothScore -= Math.abs(val - b.grid[i][j + 1]);
        }
        if (i + 1 < 4 && b.grid[i + 1][j] !== 0) {
          smoothScore -= Math.abs(val - b.grid[i + 1][j]);
        }
      }
    }
  }

  return (
    monoScore * WEIGHT_FACTOR +
    empty * EMPTY_FACTOR +
    smoothScore * SMOOTH_FACTOR
  );
}

export function expectimax(
  b: Board,
  depth: number,
  isPlayer: boolean,
  tt: Map<bigint, TTEntry>,
  deadline: number,
): number {
  if (depth <= 0 || b.lose()) {
    return evaluate(b);
  }

  // Check timeout deadline during deep searches
  if (Date.now() > deadline) {
    return evaluate(b);
  }

  // Transposition table check (only on player nodes)
  const bitKey = boardToBitKey(b);
  if (isPlayer) {
    const cached = tt.get(bitKey);
    if (cached && cached.depth >= depth) {
      return cached.score;
    }
  }

  let resultScore: number;

  if (isPlayer) {
    let best = -1e9;
    for (let dir = 0; dir < 4; dir++) {
      const next = mover(b, dir);
      if (!next.equals(b)) {
        const val = expectimax(next, depth - 1, false, tt, deadline);
        if (val > best) best = val;
      }
    }
    resultScore = best;
    tt.set(bitKey, { depth, score: resultScore });
  } else {
    const emptyCells: [number, number][] = [];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        if (b.grid[i][j] === 0) emptyCells.push([i, j]);
      }
    }
    if (emptyCells.length === 0) return evaluate(b);

    const prob = 1.0 / emptyCells.length;
    let total = 0;
    for (const [r, c] of emptyCells) {
      const next = b.clone();
      next.grid[r][c] = 2;
      total += prob * expectimax(next, depth - 1, true, tt, deadline);
    }
    resultScore = total;
  }

  return resultScore;
}

/**
 * Calculates adaptive target depth.
 * When the board reaches a tight-critical endgame (empty <= 3), search depth expands
 * up to 20–25 to find critical high-scoring combinations.
 */
export function getAdaptiveMaxDepth(
  emptyCount: number,
  configuredDepth: number,
): number {
  if (emptyCount <= 1) {
    // 1 empty cell: branching is trivial, allow full depth up to 25
    return Math.min(configuredDepth, 25);
  }
  if (emptyCount === 2) {
    // 2 empty cells: allow deep 20–22 search
    return Math.min(configuredDepth, 22);
  }
  if (emptyCount === 3) {
    // 3 empty cells: allow depth up to 16
    return Math.min(configuredDepth, 16);
  }
  if (emptyCount <= 5) {
    return Math.min(configuredDepth, 8);
  }
  if (emptyCount <= 8) {
    return Math.min(configuredDepth, 6);
  }
  // Open board (9+ empty cells)
  return Math.min(configuredDepth, 4);
}

/**
 * Finds the best move using iterative deepening with a transposition table and
 * time budget. This guarantees deep endgame searches up to depth 25 while
 * preventing UI lockup.
 */
export function getBestMove(
  b: Board,
  configuredDepth: number = 7,
  timeBudgetMs: number = 250,
): MoveDirection | null {
  const validMoves: { dir: number; move: MoveDirection; next: Board }[] = [];
  for (let dir = 0; dir < 4; dir++) {
    const next = mover(b, dir);
    if (!next.equals(b)) {
      validMoves.push({ dir, move: MOVES[dir], next });
    }
  }

  if (validMoves.length === 0) return null;
  if (validMoves.length === 1) return validMoves[0].move;

  let emptyCount = 0;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if (b.grid[i][j] === 0) emptyCount++;
    }
  }

  const targetDepth = getAdaptiveMaxDepth(emptyCount, configuredDepth);
  const tt = new Map<bigint, TTEntry>();
  const deadline = Date.now() + timeBudgetMs;

  let overallBestMove = validMoves[0].move;

  // Iterative deepening from depth 2 up to targetDepth
  for (let d = 2; d <= targetDepth; d++) {
    let currentBestScore = -1e9;
    let currentBestMove = overallBestMove;
    let iterationTimedOut = false;

    for (const { move, next } of validMoves) {
      if (Date.now() > deadline) {
        iterationTimedOut = true;
        break;
      }
      const score = expectimax(next, d - 1, false, tt, deadline);
      if (score > currentBestScore) {
        currentBestScore = score;
        currentBestMove = move;
      }
    }

    if (!iterationTimedOut) {
      overallBestMove = currentBestMove;
    } else {
      break;
    }
  }

  return overallBestMove;
}

// ---------------------------------------------------------------------------
// 5. Cheat Automation & Lifecycle
// ---------------------------------------------------------------------------

function hashGrid(grid: number[][]): string {
  return grid.map((r) => r.join(",")).join(";");
}

export async function onTick(pane: Pane, cheat: Cheat): Promise<void> {
  if (pane.busy || pane.state !== "connected") return;

  // Configured speed (delay in ms between keypresses)
  const speed = Number(cheat.getValue("Speed")) || 100;
  const now = Date.now();
  const lastTime = lastMoveTime.get(pane.id) ?? 0;

  // Throttle ticks to respect the configured delay between keypresses
  if (now - lastTime < speed) {
    return;
  }

  const lines = stdout.getViewport(pane);
  const grid = parse2048Board(lines);
  if (!grid) return;

  const currentHash = hashGrid(grid);
  if (lastBoardHash.get(pane.id) === currentHash) {
    return;
  }

  const board = new Board(grid);
  if (board.lose()) {
    return;
  }

  pane.busy = true;
  try {
    const configuredDepth = Number(cheat.getValue("Depth")) || 7;
    // Allocate up to 350ms for deep endgame searches
    const move = getBestMove(board, configuredDepth, 350);

    if (move) {
      lastBoardHash.set(pane.id, currentHash);
      await stdin.sendkey(pane, move);
      lastMoveTime.set(pane.id, Date.now());

      // Sleep for the configured speed before releasing busy state
      if (speed > 0) {
        await sleep(speed);
      }
    }
  } catch (err) {
    console.error("[2048]: Solver error:", err);
  } finally {
    pane.busy = false;
  }
}

export function onToggle(pane: Pane, cheat: Cheat, enabled: boolean): void {
  if (!enabled) {
    lastBoardHash.delete(pane.id);
    lastMoveTime.delete(pane.id);
  }
}

export function onDisconnect(pane: Pane): void {
  lastBoardHash.delete(pane.id);
  lastMoveTime.delete(pane.id);
}
