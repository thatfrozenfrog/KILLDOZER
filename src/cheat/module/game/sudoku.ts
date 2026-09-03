import * as stdout from "../../output";
import * as stdin from "../../input";
import type { Pane } from "../../../pane";
import type { Cheat } from "../../registry";
import { sleep } from "../../../gadget";

export type SudokuMove =
  | "up"
  | "down"
  | "left"
  | "right"
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9";

interface Point {
  r: number;
  c: number;
}

interface TargetCell extends Point {
  val: number;
}

// ---------------------------------------------------------------------------
// 1. Terminal Board Parser
// ---------------------------------------------------------------------------

export function parseSudoku(lines: string[]): number[][] {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && !line.includes("-") && !line.includes("="))
    .slice(0, 9)
    .map((line) => {
      const innerContent = line.replace(/^\|/, "").replace(/\|$/, "");
      return innerContent
        .split(/[:|]/)
        .map((cell) => {
          const val = parseInt(cell.trim(), 10);
          return Number.isNaN(val) ? 0 : val;
        })
        .slice(0, 9);
    });
}

// ---------------------------------------------------------------------------
// 2. Bitmask + MRV Backtracking Solver
// ---------------------------------------------------------------------------

const getBoxIndex = (r: number, c: number) => Math.floor(r / 3) * 3 + Math.floor(c / 3);

function countBits(n: number): number {
  let count = 0;
  let val = n;
  while (val) {
    val &= val - 1;
    count++;
  }
  return count;
}

/** Solves a 9x9 sudoku grid using backtracking with bitmask constraint propagation & MRV. */
export function solveSudoku(grid: number[][]): number[][] | null {
  if (!grid || grid.length !== 9 || !grid.every((row) => row && row.length === 9)) {
    return null;
  }

  const board = grid.map((row) => [...row]);
  const rowMask = new Uint16Array(9);
  const colMask = new Uint16Array(9);
  const boxMask = new Uint16Array(9);
  const emptyCells: Point[] = [];

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const val = board[r][c];
      if (val > 0) {
        const bit = 1 << val;
        const b = getBoxIndex(r, c);
        if ((rowMask[r] & bit) || (colMask[c] & bit) || (boxMask[b] & bit)) {
          console.error(`[sudoku]: Invalid clue conflict at (${r}, ${c}) = ${val}`);
          return null;
        }
        rowMask[r] |= bit;
        colMask[c] |= bit;
        boxMask[b] |= bit;
      } else {
        emptyCells.push({ r, c });
      }
    }
  }

  const getCandidates = (r: number, c: number) => {
    const used = rowMask[r] | colMask[c] | boxMask[getBoxIndex(r, c)];
    return ~used & 0x3fe; // valid digits 1..9
  };

  function backtrack(): boolean {
    if (emptyCells.length === 0) return true;

    // Minimum Remaining Values (MRV) heuristic: pick the most constrained cell first
    let bestIdx = -1;
    let minCandidates = 10;
    let bestMask = 0;

    for (let i = 0; i < emptyCells.length; i++) {
      const { r, c } = emptyCells[i];
      const mask = getCandidates(r, c);
      const count = countBits(mask);
      if (count === 0) return false; // Dead end, backtrack
      if (count < minCandidates) {
        minCandidates = count;
        bestIdx = i;
        bestMask = mask;
        if (count === 1) break; // Optimal single candidate
      }
    }

    const cell = emptyCells[bestIdx];
    emptyCells.splice(bestIdx, 1);
    const b = getBoxIndex(cell.r, cell.c);

    for (let num = 1; num <= 9; num++) {
      const bit = 1 << num;
      if (bestMask & bit) {
        board[cell.r][cell.c] = num;
        rowMask[cell.r] |= bit;
        colMask[cell.c] |= bit;
        boxMask[b] |= bit;

        if (backtrack()) return true;

        board[cell.r][cell.c] = 0;
        rowMask[cell.r] &= ~bit;
        colMask[cell.c] &= ~bit;
        boxMask[b] &= ~bit;
      }
    }

    emptyCells.splice(bestIdx, 0, cell);
    return false;
  }

  return backtrack() ? board : null;
}

// ---------------------------------------------------------------------------
// 3. Optimal Path Finding (Multi-start 2-opt TSP on Grid)
// ---------------------------------------------------------------------------

function manhattan(a: Point, b: Point): number {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
}

function pathDistance(start: Point, path: TargetCell[]): number {
  if (path.length === 0) return 0;
  let d = manhattan(start, path[0]);
  for (let i = 0; i < path.length - 1; i++) {
    d += manhattan(path[i], path[i + 1]);
  }
  return d;
}

function twoOpt(start: Point, path: TargetCell[]): TargetCell[] {
  const best = [...path];
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const prevA = i === 0 ? start : best[i - 1];
        const a = best[i];
        const b = best[j];
        const nextB = j === best.length - 1 ? null : best[j + 1];

        const oldCost = manhattan(prevA, a) + (nextB ? manhattan(b, nextB) : 0);
        const newCost = manhattan(prevA, b) + (nextB ? manhattan(a, nextB) : 0);

        if (newCost < oldCost) {
          let l = i;
          let r = j;
          while (l < r) {
            const tmp = best[l];
            best[l] = best[r];
            best[r] = tmp;
            l++;
            r--;
          }
          improved = true;
        }
      }
    }
  }

  return best;
}

function findOptimalPath(start: Point, cells: TargetCell[]): TargetCell[] {
  if (cells.length <= 1) return [...cells];

  // Candidate 1: Nearest-Neighbor
  const unvisited = [...cells];
  let curr = start;
  const nn: TargetCell[] = [];
  while (unvisited.length > 0) {
    let bestIdx = 0;
    let minDist = manhattan(curr, unvisited[0]);
    for (let i = 1; i < unvisited.length; i++) {
      const d = manhattan(curr, unvisited[i]);
      if (d < minDist) {
        minDist = d;
        bestIdx = i;
      }
    }
    const next = unvisited.splice(bestIdx, 1)[0];
    nn.push(next);
    curr = next;
  }

  // Candidate 2: Row-snake (alternating sweeps left-to-right & right-to-left)
  const rowSnake = [...cells].sort((a, b) => {
    if (a.r !== b.r) return a.r - b.r;
    return a.r % 2 === 0 ? a.c - b.c : b.c - a.c;
  });

  // Candidate 3: Col-snake (alternating sweeps top-to-bottom & bottom-to-top)
  const colSnake = [...cells].sort((a, b) => {
    if (a.c !== b.c) return a.c - b.c;
    return a.c % 2 === 0 ? a.r - b.r : b.r - a.r;
  });

  const candidates = [nn, rowSnake, colSnake].map((p) => twoOpt(start, p));
  let best = candidates[0];
  let bestDist = pathDistance(start, best);

  for (let i = 1; i < candidates.length; i++) {
    const d = pathDistance(start, candidates[i]);
    if (d < bestDist) {
      bestDist = d;
      best = candidates[i];
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// 4. Move Generation
// ---------------------------------------------------------------------------

/**
 * Given the initial unsolved grid and its solved counterpart, generates the
 * shortest optimal sequence of arrow moves ("up", "down", "left", "right")
 * and digit entries ("1".."9") starting from row 0, col 0.
 */
export function generateOptimalMoves(
  initialGrid: number[][],
  solution: number[][],
  start: Point = { r: 0, c: 0 }
): SudokuMove[] {
  const emptyCells: TargetCell[] = [];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (initialGrid[r][c] === 0) {
        emptyCells.push({ r, c, val: solution[r][c] });
      }
    }
  }

  if (emptyCells.length === 0) return [];

  const path = findOptimalPath(start, emptyCells);
  const moves: SudokuMove[] = [];
  let curR = start.r;
  let curC = start.c;

  for (const target of path) {
    const dr = target.r - curR;
    const dc = target.c - curC;

    if (dr > 0) {
      for (let i = 0; i < dr; i++) moves.push("down");
    } else if (dr < 0) {
      for (let i = 0; i < -dr; i++) moves.push("up");
    }

    if (dc > 0) {
      for (let i = 0; i < dc; i++) moves.push("right");
    } else if (dc < 0) {
      for (let i = 0; i < -dc; i++) moves.push("left");
    }

    moves.push(String(target.val) as SudokuMove);
    curR = target.r;
    curC = target.c;
  }

  return moves;
}

/** High-level helper: solves the grid and returns both solution and optimal move list */
export function solveSudokuWithMoves(
  grid: number[][],
  start: Point = { r: 0, c: 0 }
): { solution: number[][]; moves: SudokuMove[] } | null {
  const solution = solveSudoku(grid);
  if (!solution) return null;
  const moves = generateOptimalMoves(grid, solution, start);
  return { solution, moves };
}

// ---------------------------------------------------------------------------
// 5. Execution & Cheat Automation
// ---------------------------------------------------------------------------

export async function executeMoves(pane: Pane, moves: SudokuMove[], delayMs = 30): Promise<void> {
  for (const move of moves) {
    if (move === "up") await stdin.sendkey(pane, "Up");
    else if (move === "down") await stdin.sendkey(pane, "Down");
    else if (move === "left") await stdin.sendkey(pane, "Left");
    else if (move === "right") await stdin.sendkey(pane, "Right");
    else if (/^[0-9]$/.test(move)) await stdin.send(pane, move, true);

    if (delayMs > 0) await sleep(delayMs);
  }
}

async function triggerSolve(pane: Pane, cheat: Cheat, lines?: string[]): Promise<void> {
  if (pane.busy || pane.state !== "connected") return;

  const boardLines = lines ?? stdout.getViewport(pane);
  if (boardLines[0] !== ".===================================,") {
    return;
  }

  pane.busy = true;
  try {
    const grid = parseSudoku(boardLines);
    const hasEmpty = grid.some((row) => row.some((cell) => cell === 0));
    if (!hasEmpty) {
      return;
    }

    console.log("[sudoku]: Solving puzzle from current viewport...");
    const result = solveSudokuWithMoves(grid, { r: 0, c: 0 });
    if (!result) {
      console.error("[sudoku]: Failed to find a valid solution for the board.");
      return;
    }

    console.log(`[sudoku]: Solved! Executing ${result.moves.length} optimal moves...`);
    const speed = Number(cheat.getValue("Speed")) || 200; // delay in milliseconds

    await executeMoves(pane, result.moves, speed);
    console.log("[sudoku]: Auto Solve completed successfully.");
  } finally {
    pane.busy = false;
  }
}

export async function onConfigChange(
  pane: Pane,
  cheat: Cheat,
  label: string,
  value: any
): Promise<void> {
  if (label === "Auto Solve" && value === true) {
    console.log("[sudoku]: Auto Solve triggered via config change");
    const lines = stdout.getViewport(pane);
    if (lines[0] === ".===================================,") {
      await triggerSolve(pane, cheat, lines);
    }
    const opt = cheat.getConfigByLabel("Auto Solve");
    if (opt) opt.value = false;
  }
}

export async function onTick(pane: Pane, cheat: Cheat): Promise<void> {
  if (pane.busy || pane.state !== "connected") return;

  const lines = stdout.getViewport(pane);
  if (lines[0] === ".===================================,") {
    await triggerSolve(pane, cheat, lines);
  }
}
