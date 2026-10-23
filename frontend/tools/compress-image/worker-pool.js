// Runs compression jobs on up to `size` workers. Jobs start in queue order while the running
// jobs' estimated memory stays within `memoryBudget`; a job always starts when nothing else
// runs. A worker that fails or times out is terminated and replaced on demand. So is one that
// ran a job over `recycleAboveMegapixels`, because WebAssembly memory never shrinks.
const cancelled = () => new Error("Cancelled");

export class WorkerPool {
  constructor({ create, size, memoryBudget, timeoutFor, recycleAboveMegapixels = 8 }) {
    Object.assign(this, { create, size, memoryBudget, timeoutFor, recycleAboveMegapixels });
    this.idle = [];
    this.running = new Map();
    this.queue = [];
    const pool = this;
    this.stats = {
      created: 0,
      maxConcurrent: 0,
      get alive() {
        return pool.idle.length + pool.running.size;
      },
    };
  }

  // options: memory, megapixels, transfer, onLog(stage, details), onStart(), onFinish(), signal, plus
  // anything timeoutFor needs (it receives the options).
  run(payload, options = {}) {
    return new Promise((resolve, reject) => {
      const job = { payload, options, resolve, reject };
      if (options.signal?.aborted) return reject(cancelled());
      options.signal?.addEventListener("abort", () => this.cancel(job), { once: true });
      this.queue.push(job);
      this.pump();
    });
  }

  terminate() {
    const queued = this.queue;
    this.queue = [];
    queued.forEach((job) => job.reject(cancelled()));
    [...this.running.values()].forEach((job) => this.finish(job, cancelled()));
    this.idle.forEach((worker) => worker.terminate());
    this.idle = [];
  }

  cancel(job) {
    const index = this.queue.indexOf(job);
    if (index >= 0) {
      this.queue.splice(index, 1);
      job.reject(cancelled());
    } else if (job.worker) this.finish(job, cancelled());
  }

  pump() {
    while (this.queue.length && this.running.size < this.size) {
      const job = this.queue[0];
      // An aborted signal cancels every job sharing it; don't start one only to stop it.
      if (job.options.signal?.aborted) {
        this.queue.shift();
        job.reject(cancelled());
        continue;
      }
      const used = [...this.running.values()].reduce((total, running) => total + (running.options.memory || 0), 0);
      if (this.running.size && used + (job.options.memory || 0) > this.memoryBudget) break;
      this.queue.shift();
      this.start(job);
    }
  }

  start(job) {
    const worker = this.idle.pop() || this.spawn();
    job.worker = worker;
    this.running.set(worker, job);
    this.stats.maxConcurrent = Math.max(this.stats.maxConcurrent, this.running.size);
    job.timer = setTimeout(() => this.finish(job, new Error("Compression timed out. Try a smaller image.")), this.timeoutFor(job.options));
    worker.onmessage = ({ data }) => {
      if (data.log) job.options.onLog?.(data.log.stage, data.log.details);
      else if (data.error) this.finish(job, new Error(data.error));
      else this.finish(job, null, data.needsPixels ? { needsPixels: true } : data.result);
    };
    worker.onerror = (event) => this.finish(job, new Error(event.message || "Compression worker failed."));
    worker.onmessageerror = () => this.finish(job, new Error("Unable to read the compression worker response."));
    job.options.onStart?.();
    worker.postMessage(job.payload, job.options.transfer || []);
  }

  spawn() {
    this.stats.created++;
    return this.create();
  }

  finish(job, error, result) {
    if (job.done) return;
    job.done = true;
    clearTimeout(job.timer);
    const { worker } = job;
    this.running.delete(worker);
    worker.onmessage = worker.onerror = worker.onmessageerror = null;
    if (error || (job.options.megapixels || 0) > this.recycleAboveMegapixels) worker.terminate();
    else this.idle.push(worker);
    job.options.onFinish?.();
    if (error) job.reject(error);
    else job.resolve(result);
    this.pump();
  }
}
