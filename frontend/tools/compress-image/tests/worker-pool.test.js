// Pool failures: more jobs running than workers; jobs starting out of queue order; idle
// workers not reused (codecs reloaded every batch); the memory budget exceeded, or a single
// over-budget job never starting; a timed-out or failed worker reused, or taking other jobs
// down with it; cancellation leaving a queued job to start or a busy worker running;
// terminate() leaving workers alive or the pool unusable; a worker that ran a large job kept
// (WebAssembly memory never shrinks); logs reaching the wrong job; the needsPixels reply lost.
// timeoutFor receives the run options, so callers can derive the limit from megapixels.
import { WorkerPool } from "../worker-pool.js";
import { poolSize, jobMemoryBytes, jobTimeoutMs } from "../config.js";

class FakeWorker {
  static created = [];
  constructor() {
    this.messages = [];
    this.terminated = false;
    FakeWorker.created.push(this);
  }
  postMessage(payload, transfer) {
    this.pending = true;
    this.messages.push({ payload, transfer });
  }
  terminate() {
    this.terminated = true;
  }
  reply(data) {
    if (!data.log) this.pending = false;
    this.onmessage({ data });
  }
  get job() {
    return this.messages.at(-1)?.payload;
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function makePool(options = {}) {
  FakeWorker.created = [];
  return new WorkerPool({ create: () => new FakeWorker(), size: 2, memoryBudget: 1000, timeoutFor: () => 60000, ...options });
}
const busy = () => FakeWorker.created.filter((worker) => !worker.terminated && worker.pending);
describe("WorkerPool", () => {
  it("runs at most `size` jobs at once, in queue order, and reuses idle workers", async () => {
    const pool = makePool();
    const results = [1, 2, 3, 4].map((id) => pool.run({ id }, { memory: 10 }));
    await flush();
    expect(FakeWorker.created).toHaveLength(2);
    expect(busy().map((worker) => worker.job.id)).toEqual([1, 2]);
    FakeWorker.created[0].reply({ result: "one" });
    await flush();
    expect(FakeWorker.created).toHaveLength(2);
    expect(FakeWorker.created[0].job.id).toBe(3);
    FakeWorker.created[1].reply({ result: "two" });
    FakeWorker.created[0].reply({ result: "three" });
    await flush();
    FakeWorker.created[1].reply({ result: "four" });
    expect(await Promise.all(results)).toEqual(["one", "two", "three", "four"]);
    expect(pool.stats.created).toBe(2);
    expect(pool.stats.maxConcurrent).toBe(2);
  });

  it("keeps the memory budget, but always starts a job when nothing else runs", async () => {
    const pool = makePool({ memoryBudget: 1000 });
    const big = pool.run({ id: "big" }, { memory: 1500 });
    const next = pool.run({ id: "next" }, { memory: 100 });
    await flush();
    expect(busy().map((worker) => worker.job.id)).toEqual(["big"]);
    busy()[0].reply({ result: "big" });
    await flush();
    expect(busy().map((worker) => worker.job.id)).toEqual(["next"]);
    busy()[0].reply({ result: "next" });
    expect(await Promise.all([big, next])).toEqual(["big", "next"]);
    expect(pool.stats.maxConcurrent).toBe(1);
  });

  it("keeps queue order even when a later job would fit the budget", async () => {
    const pool = makePool({ memoryBudget: 1000 });
    pool.run({ id: "a" }, { memory: 600 });
    pool.run({ id: "b" }, { memory: 600 });
    pool.run({ id: "c" }, { memory: 100 });
    await flush();
    expect(busy().map((worker) => worker.job.id)).toEqual(["a"]);
  });

  it("times out a job, terminates its worker and gives the next job a fresh one", async () => {
    vi.useFakeTimers();
    try {
      const pool = makePool({ size: 1, timeoutFor: (job) => job.timeout });
      const slow = pool.run({ id: "slow" }, { memory: 10, timeout: 5000 });
      const after = pool.run({ id: "after" }, { memory: 10, timeout: 5000 });
      const slowFailed = expect(slow).rejects.toThrow(/timed out/i);
      await vi.advanceTimersByTimeAsync(5001);
      await slowFailed;
      expect(FakeWorker.created[0].terminated).toBe(true);
      expect(FakeWorker.created).toHaveLength(2);
      FakeWorker.created[1].reply({ result: "after" });
      expect(await after).toBe("after");
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails only the job whose worker reports an error, and replaces that worker", async () => {
    const pool = makePool();
    const broken = pool.run({ id: "broken" }, { memory: 10 });
    const fine = pool.run({ id: "fine" }, { memory: 10 });
    await flush();
    FakeWorker.created[0].reply({ error: "Codec failed." });
    await expect(broken).rejects.toThrow("Codec failed.");
    expect(FakeWorker.created[0].terminated).toBe(true);
    FakeWorker.created[1].reply({ result: "fine" });
    expect(await fine).toBe("fine");
    const third = pool.run({ id: "third" }, { memory: 10 });
    await flush();
    expect(FakeWorker.created[1].job.id).toBe("third");
    FakeWorker.created[1].reply({ result: "third" });
    expect(await third).toBe("third");
  });

  it("cancels queued and running jobs through the signal", async () => {
    const pool = makePool({ size: 1 });
    const controller = new AbortController();
    const running = pool.run({ id: "running" }, { memory: 10, signal: controller.signal });
    const queued = pool.run({ id: "queued" }, { memory: 10, signal: controller.signal });
    await flush();
    controller.abort();
    await expect(running).rejects.toThrow("Cancelled");
    await expect(queued).rejects.toThrow("Cancelled");
    expect(FakeWorker.created[0].terminated).toBe(true);
    expect(FakeWorker.created[0].messages.map((message) => message.payload.id)).toEqual(["running"]);
    expect(FakeWorker.created).toHaveLength(1);
    await expect(pool.run({ id: "late" }, { memory: 10, signal: controller.signal })).rejects.toThrow("Cancelled");
  });

  it("terminate() stops every worker and rejects every job; the pool still works afterwards", async () => {
    const pool = makePool();
    const jobs = [1, 2, 3].map((id) => pool.run({ id }, { memory: 10 }));
    await flush();
    pool.terminate();
    for (const job of jobs) await expect(job).rejects.toThrow("Cancelled");
    expect(FakeWorker.created.every((worker) => worker.terminated)).toBe(true);
    const again = pool.run({ id: "again" }, { memory: 10 });
    await flush();
    FakeWorker.created.at(-1).reply({ result: "again" });
    expect(await again).toBe("again");
  });

  it("replaces a worker after a job over 8 megapixels", async () => {
    const pool = makePool({ size: 1 });
    const large = pool.run({ id: "large" }, { memory: 10, megapixels: 12 });
    await flush();
    FakeWorker.created[0].reply({ result: "large" });
    await large;
    expect(FakeWorker.created[0].terminated).toBe(true);
    const small = pool.run({ id: "small" }, { memory: 10, megapixels: 2 });
    await flush();
    FakeWorker.created[1].reply({ result: "small" });
    await small;
    expect(FakeWorker.created[1].terminated).toBe(false);
  });

  it("routes logs to their own job, reports the start, and passes needsPixels through", async () => {
    const pool = makePool();
    const logs = { a: [], b: [] };
    const started = [];
    const a = pool.run({ id: "a" }, { memory: 10, onLog: (stage) => logs.a.push(stage), onStart: () => started.push("a") });
    const b = pool.run({ id: "b" }, { memory: 10, onLog: (stage) => logs.b.push(stage), onStart: () => started.push("b") });
    await flush();
    FakeWorker.created[1].reply({ log: { stage: "Encoding", details: {} } });
    FakeWorker.created[0].reply({ log: { stage: "Decoding", details: {} } });
    FakeWorker.created[0].reply({ needsPixels: true });
    FakeWorker.created[1].reply({ result: "b" });
    expect(await a).toEqual({ needsPixels: true });
    expect(await b).toBe("b");
    expect(logs).toEqual({ a: ["Decoding"], b: ["Encoding"] });
    expect(started).toEqual(["a", "b"]);
  });

  it("reports a job's finish before the next queued job starts", async () => {
    const pool = makePool({ size: 1 });
    const events = [];
    const first = pool.run({ id: 1 }, { memory: 10, onStart: () => events.push("start 1"), onFinish: () => events.push("finish 1") });
    pool.run({ id: 2 }, { memory: 10, onStart: () => events.push("start 2") });
    await flush();
    FakeWorker.created[0].reply({ result: "one" });
    await first;
    expect(events).toEqual(["start 1", "finish 1", "start 2"]);
  });
  it("transfers the payload buffers it is given", async () => {
    const pool = makePool();
    const buffer = new ArrayBuffer(8);
    pool.run({ bytes: buffer }, { memory: 10, transfer: [buffer] });
    await flush();
    expect(FakeWorker.created[0].messages[0].transfer).toEqual([buffer]);
  });
});

// Sizing failures: more than three workers, none on a single core, several on a phone; memory
// estimates that ignore the file or unknown dimensions; timeouts too short for large images or
// unbounded.
describe("pool sizing", () => {
  it("uses cores minus one, between one and three, and one on narrow screens", () => {
    expect([1, 2, 4, 8, 16].map((cores) => poolSize(cores, false))).toEqual([1, 1, 3, 3, 3]);
    expect(poolSize(8, true)).toBe(1);
    expect(poolSize(undefined, false)).toBe(1);
  });
  it("estimates job memory from dimensions and file size, assuming 16 MP when unknown", () => {
    expect(jobMemoryBytes(1000, 1000, 500)).toBe(16000500);
    expect(jobMemoryBytes(undefined, undefined, 500)).toBe(16000000 * 16 + 500);
  });
  it("allows 15 s plus 3 s per megapixel, up to 120 s", () => {
    expect(jobTimeoutMs(0)).toBe(15000);
    expect(jobTimeoutMs(4)).toBe(27000);
    expect(jobTimeoutMs(16)).toBe(63000);
    expect(jobTimeoutMs(100)).toBe(120000);
    expect(jobTimeoutMs(undefined)).toBe(63000);
  });
});
