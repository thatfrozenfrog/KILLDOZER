export function findAutologinPromptLine(
  lines: readonly string[],
  accepts: (line: string) => boolean = () => true,
): string {
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index].trim();
    if (
      line &&
      !line.startsWith("<") &&
      !line.startsWith("[[KD1|") &&
      accepts(line)
    ) {
      return line;
    }
  }
  return "";
}
