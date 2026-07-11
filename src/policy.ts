import type { TurnPolicy } from "./types.js";

/** Selects the highest finite score. Map insertion order breaks ties deterministically. */
export class HighestScorePolicy implements TurnPolicy {
  select({ bids }: Parameters<TurnPolicy["select"]>[0]): string | null {
    let selected: string | null = null;
    let highest = -Infinity;

    for (const [id, bid] of bids) {
      if (bid.abstain || !Number.isFinite(bid.score)) continue;
      if (selected === null || bid.score > highest) {
        selected = id;
        highest = bid.score;
      }
    }
    return selected;
  }
}
