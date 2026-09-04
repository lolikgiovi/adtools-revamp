/**
 * Run async task factories with a bounded number of tasks in flight.
 * Results retain the input order.
 *
 * @param {Array<() => Promise<unknown>>} tasks
 * @param {number} limit
 * @returns {Promise<unknown[]>}
 */
export function runWithConcurrency(tasks, limit = 8) {
  const taskList = Array.from(tasks || []);
  if (taskList.length === 0) return Promise.resolve([]);

  const concurrency = Math.max(1, Math.min(Number(limit) || 1, taskList.length));
  const results = new Array(taskList.length);

  return new Promise((resolve, reject) => {
    let nextIndex = 0;
    let completed = 0;
    let settled = false;

    const runNext = () => {
      if (settled) return;
      const index = nextIndex++;
      if (index >= taskList.length) return;

      Promise.resolve()
        .then(() => taskList[index]())
        .then((result) => {
          results[index] = result;
          completed += 1;
          if (completed === taskList.length) {
            settled = true;
            resolve(results);
            return;
          }
          runNext();
        })
        .catch((error) => {
          if (!settled) {
            settled = true;
            reject(error);
          }
        });
    };

    for (let i = 0; i < concurrency; i++) runNext();
  });
}

export const IMAGE_CHECK_CONCURRENCY = 8;
