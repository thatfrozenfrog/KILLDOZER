import type { Pane } from "../../../pane";
import type { Cheat } from "../../registry";
import { initDozer } from "../../../dozer";

export async function tick(_pane: Pane, _cheat: Cheat): Promise<void> {
  const dozer = initDozer();
  dozer.updateVisibility();
}

