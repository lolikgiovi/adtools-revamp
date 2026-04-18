const DEFAULT_DELAY_MS = 800;

function cloneTableData(tableData) {
  if (!Array.isArray(tableData)) return tableData;
  return tableData.map((row) => (Array.isArray(row) ? [...row] : row));
}

export class TableAutosaveService {
  constructor({ delayMs = DEFAULT_DELAY_MS, save, onError = console.error } = {}) {
    if (typeof save !== "function") {
      throw new Error("TableAutosaveService requires a save function");
    }

    this.delayMs = delayMs;
    this.save = save;
    this.onError = onError;
    this._timer = null;
    this._pending = null;
    this._writeChain = Promise.resolve();
    this._destroyed = false;
  }

  schedule(tableName, tableData) {
    if (this._destroyed || !tableName) return;

    this._pending = {
      tableName,
      tableData: cloneTableData(tableData),
    };

    this._clearTimer();
    this._timer = setTimeout(() => {
      this._timer = null;
      void this.flush();
    }, this.delayMs);
  }

  flush() {
    this._clearTimer();

    if (!this._pending) {
      return this._writeChain;
    }

    const pending = this._pending;
    this._pending = null;

    const writePromise = this._writeChain.then(() => this._safeSave(pending.tableName, pending.tableData));
    this._writeChain = writePromise.then(
      () => undefined,
      () => undefined,
    );

    return writePromise;
  }

  cancel() {
    this._clearTimer();
    this._pending = null;
  }

  destroy({ flush = true } = {}) {
    this._destroyed = true;
    if (flush) {
      return this.flush();
    }

    this.cancel();
    return this._writeChain;
  }

  async _safeSave(tableName, tableData) {
    try {
      return await this.save(tableName, tableData);
    } catch (error) {
      this.onError(error);
      return false;
    }
  }

  _clearTimer() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}
