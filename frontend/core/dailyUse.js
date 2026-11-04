// Automatic work (live previews, debounced renders) counts as one use per key per local day.
const memory = new Map();

export function claimDailyUse(storageKey, key) {
  const day = new Date().toLocaleDateString("en-CA");
  let counted = memory.get(storageKey);
  try {
    counted = JSON.parse(localStorage.getItem(storageKey)) || counted;
  } catch (_) {}
  if (counted?.day !== day || !Array.isArray(counted.keys)) counted = { day, keys: [] };
  if (counted.keys.includes(key)) return false;
  counted = { day, keys: [...counted.keys, key] };
  memory.set(storageKey, counted);
  try {
    localStorage.setItem(storageKey, JSON.stringify(counted));
  } catch (_) {}
  return true;
}
