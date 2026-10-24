// Search only within the user's quality floor. Codec sizes can vary, so retain
// the best observed output instead of assuming every lower quality is smaller.
export async function encodeForTarget(encode, floor, targetBytes = 0, ceiling = 100) {
  if (!targetBytes) return encode(floor);
  let best = null;
  const attempt = async (quality) => {
    const candidate = await encode(quality);
    if (candidate) {
      candidate.quality = quality;
      const fits = candidate.bytes.length < targetBytes;
      const bestFits = best && best.bytes.length < targetBytes;
      if (!best || (fits && (!bestFits || quality > best.quality)) || (!fits && !bestFits && candidate.bytes.length < best.bytes.length)) {
        best = candidate;
      }
    }
    return candidate && candidate.bytes.length < targetBytes;
  };
  if (await attempt(ceiling)) return best;
  if (floor === ceiling || !(await attempt(floor))) return best;
  let low = floor + 1;
  let high = ceiling - 1;
  while (low <= high) {
    const quality = Math.floor((low + high) / 2);
    if (await attempt(quality)) low = quality + 1;
    else high = quality - 1;
  }
  return best;
}
