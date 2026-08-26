export type CheatFilters = {
  query: string;
  category: string;
  status: "all" | "enabled" | "disabled";
};

type CheatLike = { name: string; description: string; enabled: boolean };

function fuzzyMatch(text: string, query: string): boolean {
  const pattern = query
    .split("")
    .map((character) => character.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"))
    .join(".*?");
  return new RegExp(pattern, "i").test(text);
}

export function filterCheats<T extends CheatLike>(
  cheats: Record<string, T[]>,
  filters: CheatFilters
): Array<{ category: string; cheat: T }> {
  const query = filters.query.trim();
  return Object.keys(cheats)
    .sort()
    .flatMap((category) =>
      cheats[category]
        .filter(
          (cheat) =>
            (!filters.category || filters.category === category) &&
            (filters.status === "all" ||
              (filters.status === "enabled" ? cheat.enabled : !cheat.enabled)) &&
            (!query || fuzzyMatch(cheat.name, query) || fuzzyMatch(cheat.description, query))
        )
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((cheat) => ({ category, cheat }))
    );
}
