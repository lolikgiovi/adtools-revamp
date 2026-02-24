/**
 * Diff Worker Manager - Manages Web Worker lifecycle and communication
 *
 * Features:
 * - Task queuing with promise-based API
 * - Timeout handling (configurable, default 2 minutes)
 * - Automatic worker restart on crash
 * - Progress reporting callbacks
 * - Graceful shutdown
 */

// Default timeout: 2 minutes
const DEFAULT_TIMEOUT_MS = 120000;

/**
 * Task types matching diff-worker.js
 */
export const TaskType = {
  COMPARE_DATASETS: 'compare-datasets',
  COMPARE_CELLS: 'compare-cells',
  RECONCILE_COLUMNS: 'reconcile-columns',
  PING: 'ping'
};

/**
 * Worker state
 */
const WorkerState = {
  UNINITIALIZED: 'uninitialized',
  INITIALIZING: 'initializing',
  READY: 'ready',
  TERMINATED: 'terminated'
};

/**
 * DiffWorkerManager - Singleton manager for diff worker
 */
export class DiffWorkerManager {
  constructor(options = {}) {
    this.worker = null;
    this.state = WorkerState.UNINITIALIZED;
    this.pendingTasks = new Map();  // taskId -> { resolve, reject, timeoutId, onProgress }
    this.timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.onProgressGlobal = options.onProgress ?? null;
    this.initPromise = null;
  }

  /**
   * Initialize the worker
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.state === WorkerState.READY) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.state = WorkerState.INITIALIZING;

    this.initPromise = new Promise((resolve, reject) => {
      try {
        // URL must be inline for Vite to detect and bundle the worker
        this.worker = new Worker(new URL('./diff-worker.js', import.meta.url), { type: 'module' });

        // Handle messages from worker
        this.worker.onmessage = (event) => this.handleMessage(event);

        // Handle worker errors
        this.worker.onerror = (event) => this.handleError(event);

        // Wait for ready signal
        const readyHandler = (event) => {
          if (event.data?.type === 'ready') {
            this.worker.removeEventListener('message', readyHandler);
            this.state = WorkerState.READY;
            resolve();
          }
        };

        this.worker.addEventListener('message', readyHandler);

        // Timeout for initialization
        setTimeout(() => {
          if (this.state === WorkerState.INITIALIZING) {
            reject(new Error('Worker initialization timed out'));
            this.terminate();
          }
        }, 5000);

      } catch (error) {
        this.state = WorkerState.TERMINATED;
        reject(error);
      }
    });

    return this.initPromise;
  }

  /**
   * Handle messages from worker
   */
  handleMessage(event) {
    const { taskId, result, error, progress, type } = event.data;

    // Ignore ready message (handled in initialize)
    if (type === 'ready') return;

    // Handle progress updates
    if (progress && taskId) {
      const task = this.pendingTasks.get(taskId);
      if (task?.onProgress) {
        task.onProgress(progress);
      }
      if (this.onProgressGlobal) {
        this.onProgressGlobal(taskId, progress);
      }
      return;  // Don't resolve task on progress
    }

    // Handle task completion
    if (taskId) {
      const task = this.pendingTasks.get(taskId);
      if (!task) return;

      // Clear timeout
      if (task.timeoutId) {
        clearTimeout(task.timeoutId);
      }

      this.pendingTasks.delete(taskId);

      if (error) {
        task.reject(new Error(error));
      } else {
        task.resolve(result);
      }
    }
  }

  /**
   * Handle worker errors
   */
  handleError(event) {
    console.error('Worker error:', event);

    // Reject all pending tasks
    for (const [taskId, task] of this.pendingTasks) {
      if (task.timeoutId) {
        clearTimeout(task.timeoutId);
      }
      task.reject(new Error('Worker crashed unexpectedly'));
    }
    this.pendingTasks.clear();

    // Attempt to restart worker
    this.restartWorker();
  }

  /**
   * Restart the worker after a crash
   */
  async restartWorker() {
    this.terminate();
    this.state = WorkerState.UNINITIALIZED;
    this.initPromise = null;

    try {
      await this.initialize();
      console.log('Worker restarted successfully');
    } catch (error) {
      console.error('Failed to restart worker:', error);
    }
  }

  /**
   * Execute a task on the worker
   * @param {string} type - Task type
   * @param {Object} data - Task data
   * @param {Object} options - Task options
   * @returns {Promise<any>}
   */
  async execute(type, data, options = {}) {
    // Ensure worker is initialized
    await this.initialize();

    const taskId = crypto.randomUUID();
    const timeout = options.timeout ?? this.timeoutMs;
    const onProgress = options.onProgress ?? null;

    return new Promise((resolve, reject) => {
      // Set timeout
      const timeoutId = setTimeout(() => {
        this.pendingTasks.delete(taskId);
        reject(new Error(`Task timed out after ${timeout}ms`));

        // Consider restarting worker if task timed out
        // This prevents stuck workers from blocking future tasks
        this.restartWorker();
      }, timeout);

      // Store task
      this.pendingTasks.set(taskId, {
        resolve,
        reject,
        timeoutId,
        onProgress
      });

      // Send to worker
      this.worker.postMessage({
        taskId,
        type,
        data,
        options: {
          ...options,
          onProgress: undefined  // Don't send function to worker
        }
      });
    });
  }

  /**
   * Compare two datasets
   * @param {Array} refData - Reference data
   * @param {Array} compData - Comparator data
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async compareDatasets(refData, compData, options = {}) {
    return this.execute(
      TaskType.COMPARE_DATASETS,
      { refData, compData },
      options
    );
  }

  /**
   * Compare two cell values
   * @param {string} oldValue
   * @param {string} newValue
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async compareCells(oldValue, newValue, options = {}) {
    return this.execute(
      TaskType.COMPARE_CELLS,
      { oldValue, newValue },
      options
    );
  }

  /**
   * Reconcile columns between two datasets
   * @param {Array<string>} refHeaders
   * @param {Array<string>} compHeaders
   * @returns {Promise<Object>}
   */
  async reconcileColumns(refHeaders, compHeaders) {
    return this.execute(
      TaskType.RECONCILE_COLUMNS,
      { refHeaders, compHeaders }
    );
  }

  /**
   * Check if worker is healthy
   * @returns {Promise<boolean>}
   */
  async ping() {
    try {
      const result = await this.execute(TaskType.PING, {}, { timeout: 5000 });
      return result?.status === 'ok';
    } catch {
      return false;
    }
  }

  /**
   * Terminate the worker
   */
  terminate() {
    if (this.worker) {
      // Clear all pending tasks
      for (const [taskId, task] of this.pendingTasks) {
        if (task.timeoutId) {
          clearTimeout(task.timeoutId);
        }
        task.reject(new Error('Worker terminated'));
      }
      this.pendingTasks.clear();

      this.worker.terminate();
      this.worker = null;
    }

    this.state = WorkerState.TERMINATED;
    this.initPromise = null;
  }

  /**
   * Get current worker state
   * @returns {string}
   */
  getState() {
    return this.state;
  }

  /**
   * Get number of pending tasks
   * @returns {number}
   */
  getPendingTaskCount() {
    return this.pendingTasks.size;
  }
}

// Singleton instance
let instance = null;

/**
 * Get the singleton DiffWorkerManager instance
 * @param {Object} options - Options for new instance (only used on first call)
 * @returns {DiffWorkerManager}
 */
export function getDiffWorkerManager(options = {}) {
  if (!instance) {
    instance = new DiffWorkerManager(options);
  }
  return instance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetDiffWorkerManager() {
  if (instance) {
    instance.terminate();
    instance = null;
  }
}

export default DiffWorkerManager;
