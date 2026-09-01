export async function consumeRateLimit(kv, key, limit, expirationTtl) {
  if (!kv) throw new Error("Rate-limit storage unavailable");
  const current = Number(await kv.get(key)) || 0;
  if (current >= limit) return true;
  // ponytail: KV is eventually consistent; move strict global limits to a Durable Object if abuse proves this insufficient.
  await kv.put(key, String(current + 1), { expirationTtl });
  return false;
}

export async function clearRateLimit(kv, key) {
  await kv?.delete?.(key);
}
