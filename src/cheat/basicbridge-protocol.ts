export type BridgeOperation =
  "BEGIN" | "CAPTURE_BEGIN" | "CAPTURE_END" | "CALL" | "RET" | "END";

export interface BridgeFrame {
  runId: string;
  sequence: number;
  operation: BridgeOperation;
  arguments: string[];
}

export interface ParsedBridgeLine {
  line: string;
  frame: BridgeFrame | null;
}

const MAX_FRAME_BYTES = 1024;
const RUN_ID_REGEX = /^[A-Za-z0-9._-]{1,32}$/;
const OPERATIONS = new Set<BridgeOperation>([
  "BEGIN",
  "CAPTURE_BEGIN",
  "CAPTURE_END",
  "CALL",
  "RET",
  "END",
]);

/**
 * Parses a bridge line of the format:
 *   <id|number|OPCODE|args|callback>
 * Examples:
 *   <dirmap|1|BEGIN>
 *   <dirmap|2|CAPTURE_BEGIN|out>
 *   <dirmap|3|CAPTURE_END|out>
 *   <dirmap|4|CALL|log.capture|out|callback>
 *   <dirmap|5|RET|func.alias>
 *   <dirmap|6|END>
 */
export function parseBridgeFrame(line: string): BridgeFrame | null {
  if (
    !line.startsWith("<") ||
    line.length < 5 ||
    line.length > MAX_FRAME_BYTES ||
    line.includes("\u001b")
  ) {
    return null;
  }

  const trimmed = line.replace(/[>\s]+$/, "");
  if (!trimmed.startsWith("<")) return null;
  const fields = trimmed.slice(1).split("|");
  if (fields.length < 3) return null;

  const [runId, rawSequence, rawOperation, ...rawArguments] = fields;
  const sequence = Number(rawSequence);
  if (
    !RUN_ID_REGEX.test(runId) ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    !OPERATIONS.has(rawOperation as BridgeOperation)
  ) {
    return null;
  }

  try {
    const args = rawArguments.map((argument) => decodeURIComponent(argument));
    return {
      runId,
      sequence,
      operation: rawOperation as BridgeOperation,
      arguments: args,
    };
  } catch {
    return null;
  }
}

const COMPLETE_FRAME_REGEX =
  /<[A-Za-z0-9._-]{1,32}\|\d+\|(?:BEGIN|CAPTURE_BEGIN|CAPTURE_END|CALL|RET|END)(?:\|[^>\r\n]*)?>/;

export class BasicBridgeLineParser {
  private partial = "";

  push(data: string): ParsedBridgeLine[] {
    const combined = this.partial + data;
    const endsWithSeparator = /(?:\r\n|\r|\n)$/.test(combined);
    const lines = combined.split(/\r\n|\r|\n/);

    if (endsWithSeparator) {
      lines.pop();
      this.partial = "";
    } else {
      this.partial = lines.pop() ?? "";
    }

    const result: ParsedBridgeLine[] = lines.map((line) => {
      const cleanLine = line.replace(/\r+$/, "");
      return { line: cleanLine, frame: parseBridgeFrame(cleanLine) };
    });

    while (this.partial) {
      const match = this.partial.match(COMPLETE_FRAME_REGEX);
      if (!match || match.index === undefined) {
        break;
      }
      const frameStr = match[0];
      const frame = parseBridgeFrame(frameStr);
      if (!frame) {
        break;
      }
      const before = this.partial.slice(0, match.index);
      if (before) {
        result.push({ line: before, frame: null });
      }
      result.push({ line: frameStr, frame });
      this.partial = this.partial.slice(match.index + frameStr.length);
    }

    return result;
  }

  reset(): void {
    this.partial = "";
  }
}
