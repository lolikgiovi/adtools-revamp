import { fitDimensions } from "./service.js";

// The current dimensions are already known to exceed the target. Search the
// longest edge, keeping the largest verified fit at the selected quality floor.
export async function findLargestFit({ width, height, targetBytes, encode }) {
  let low = 1;
  let high = Math.max(width, height) - 1;
  let best = null;
  while (low <= high) {
    const edge = Math.floor((low + high) / 2);
    const dimensions = fitDimensions(width, height, edge, edge);
    const value = await encode(dimensions.width, dimensions.height);
    if (value.size < targetBytes) {
      best = { ...dimensions, value };
      low = edge + 1;
    } else high = edge - 1;
  }
  return best;
}
