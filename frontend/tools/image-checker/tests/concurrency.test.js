import { describe, expect, it } from "vitest";
import { runWithConcurrency } from "../concurrency.js";

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("runWithConcurrency", () => {
  it("handles empty input", async () => {
    await expect(runWithConcurrency([], 8)).resolves.toEqual([]);
  });

  it("preserves input order while bounding active tasks", async () => {
    const pending = Array.from({ length: 10 }, () => deferred());
    let active = 0;
    let maximumActive = 0;
    const tasks = pending.map(({ promise }, index) => async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const result = await promise;
      active -= 1;
      return `${result}-${index}`;
    });

    const resultPromise = runWithConcurrency(tasks, 3);
    await Promise.resolve();
    expect(maximumActive).toBe(3);

    pending.forEach(({ resolve }, index) => resolve(`done-${index}`));
    await expect(resultPromise).resolves.toEqual(pending.map((_, index) => `done-${index}-${index}`));
    expect(maximumActive).toBe(3);
  });

  it("starts no more tasks than are available", async () => {
    const calls = [];
    const result = await runWithConcurrency(
      [
        async () => {
          calls.push(1);
          return "one";
        },
        async () => {
          calls.push(2);
          return "two";
        },
      ],
      8,
    );

    expect(calls).toEqual([1, 2]);
    expect(result).toEqual(["one", "two"]);
  });
});
