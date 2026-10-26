import { fitDimensions } from "./service.js";

// The current dimensions are already known to exceed the target. Search the
// longest edge, keeping the largest verified fit at the selected quality floor.
// One worker uses binary search; multiple workers probe evenly spaced edges per
// round. The caller still schedules every probe through its memory-limited pool.
export async function findLargestFit({ width, height, targetBytes, encode, concurrency = 1 }) {
  let low = 1;
  let high = Math.max(width, height) - 1;
  let best = null;
  while (low <= high) {
    const count = Math.min(Math.max(1, Math.floor(concurrency) || 1), 3, high - low + 1);
    const edges = Array.from({ length: count }, (_, i) => low + Math.floor(((high - low + 1) * (i + 1)) / (count + 1)));
    const probes = await Promise.all(
      edges.map(async (edge) => {
        const dimensions = fitDimensions(width, height, edge, edge);
        return { edge, ...dimensions, value: await encode(dimensions.width, dimensions.height) };
      }),
    );
    for (const probe of probes) {
      if (probe.value.size < targetBytes) {
        if (!best || probe.edge > best.edge) best = probe;
        low = Math.max(low, probe.edge + 1);
      } else high = Math.min(high, probe.edge - 1);
    }
  }
  return best;
}
