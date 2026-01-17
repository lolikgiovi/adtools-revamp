/**
 * Diff Worker - Web Worker for non-blocking diff computation
 *
 * Runs diff operations in a separate thread to keep UI responsive.
 * Communicates via postMessage with the main thread.
 *
 * Message Protocol:
 * - Main -> Worker: { taskId, type, data, options }
 * - Worker -> Main: { taskId, result?, error?, progress? }
 */

import {
  compareDatasets,
  reconcileColumns,
  computeAdaptiveDiff,
  RowStatus
} from './diff-engine.js';

/**
 * Task types supported by this worker
 */
const TaskType = {
  COMPARE_DATASETS: 'compare-datasets',
  COMPARE_CELLS: 'compare-cells',
  RECONCILE_COLUMNS: 'reconcile-columns',
  PING: 'ping'  // Health check
};

/**
 * Handle incoming messages from main thread
 */
self.onmessage = async (event) => {
  const { taskId, type, data, options = {} } = event.data;

  try {
    let result;

    switch (type) {
      case TaskType.COMPARE_DATASETS:
        result = await handleCompareDatasets(taskId, data, options);
        break;

      case TaskType.COMPARE_CELLS:
        result = handleCompareCells(data, options);
        break;

      case TaskType.RECONCILE_COLUMNS:
        result = handleReconcileColumns(data);
        break;

      case TaskType.PING:
        result = { status: 'ok', timestamp: Date.now() };
        break;

      default:
        throw new Error(`Unknown task type: ${type}`);
    }

    // Send successful result
    self.postMessage({ taskId, result });

  } catch (error) {
    // Send error
    self.postMessage({
      taskId,
      error: error.message || 'Unknown error occurred'
    });
  }
};

/**
 * Handle dataset comparison with progress reporting
 */
async function handleCompareDatasets(taskId, data, options) {
  const { refData, compData } = data;
  const {
    keyColumns = [],
    fields = [],
    normalize = false,
    threshold = 0.5,
    matchMode = 'key'
  } = options;

  // Validate inputs
  if (!Array.isArray(refData)) {
    throw new Error('Reference data must be an array');
  }
  if (!Array.isArray(compData)) {
    throw new Error('Comparator data must be an array');
  }

  // Report starting
  reportProgress(taskId, {
    phase: 'starting',
    processed: 0,
    total: refData.length + compData.length,
    percent: 0
  });

  // Create progress callback that reports to main thread
  const onProgress = (progress) => {
    reportProgress(taskId, progress);
  };

  // Run comparison
  const result = compareDatasets(refData, compData, {
    keyColumns,
    fields,
    normalize,
    threshold,
    matchMode,
    onProgress
  });

  // Report completion
  reportProgress(taskId, {
    phase: 'complete',
    processed: result.summary.total,
    total: result.summary.total,
    percent: 100
  });

  return result;
}

/**
 * Handle single cell comparison
 */
function handleCompareCells(data, options) {
  const { oldValue, newValue } = data;
  const { threshold = 0.5 } = options;

  return computeAdaptiveDiff(oldValue, newValue, { threshold });
}

/**
 * Handle column reconciliation
 */
function handleReconcileColumns(data) {
  const { refHeaders, compHeaders } = data;

  if (!Array.isArray(refHeaders) || !Array.isArray(compHeaders)) {
    throw new Error('Headers must be arrays');
  }

  return reconcileColumns(refHeaders, compHeaders);
}

/**
 * Report progress to main thread
 */
function reportProgress(taskId, progress) {
  self.postMessage({ taskId, progress });
}

/**
 * Handle worker errors
 */
self.onerror = (error) => {
  console.error('Worker error:', error);
  self.postMessage({
    taskId: null,
    error: `Worker error: ${error.message || 'Unknown error'}`
  });
};

// Signal worker is ready
self.postMessage({ type: 'ready' });
