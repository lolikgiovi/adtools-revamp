import { getQuickQueryTableInteractionKey } from "../../../core/RecentInteractionStore.js";

/** Recently used tables first (newest first); everything else keeps its storage order. */
export function rankTableResults(results, recency = new Map()) {
  const order = (item) => recency.get(getQuickQueryTableInteractionKey(item.fullName))?.order ?? Infinity;
  return results
    .map((item, index) => ({ item, index, rank: order(item) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item);
}
