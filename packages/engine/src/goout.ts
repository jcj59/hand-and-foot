import type { PlayerState, RulesConfig } from "@hf/shared";
import { classifyBook } from "./scoring";

/** Count the clean and dirty completed books among a player's melds. */
export function bookCounts(player: PlayerState): { clean: number; dirty: number } {
  let clean = 0;
  let dirty = 0;
  for (const m of player.melds) {
    const kind = classifyBook(m);
    if (kind === "clean") clean += 1;
    else if (kind === "dirty") dirty += 1;
  }
  return { clean, dirty };
}

/**
 * Whether a player currently satisfies the requirements to go out: they must be
 * in their foot and hold at least the required number of clean and dirty books.
 * The separate requirement of shedding every card is enforced at the point a
 * play or discard would empty the last zone.
 */
export function canGoOut(player: PlayerState, config: RulesConfig): boolean {
  if (!player.inFoot) return false;
  const { clean, dirty } = bookCounts(player);
  return clean >= config.goOutCleanBooks && dirty >= config.goOutDirtyBooks;
}
