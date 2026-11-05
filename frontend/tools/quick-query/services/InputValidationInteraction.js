export class InputValidationInteraction {
  constructor() {
    this.visited = new Set();
    this.completedRows = new Set();
    this.active = null;
    this.revealAll = false;
  }

  select(row, col, endRow, endCol) {
    if (row < 1 || col < 0 || row !== endRow || col !== endCol) return;
    if (this.active?.row === row && this.active.col === col) return;
    if (this.active) {
      this.visited.add(`${this.active.row}:${this.active.col}`);
      if (this.active.row !== row) this.completedRows.add(this.active.row);
    }
    this.active = { row, col };
  }

  leave() {
    if (!this.active) return;
    this.visited.add(`${this.active.row}:${this.active.col}`);
    this.completedRows.add(this.active.row);
    this.active = null;
  }

  commit(changes, source) {
    for (const [row, col] of changes || []) {
      if (row < 1) continue;
      this.visited.add(`${row}:${col}`);
      if (source === "CopyPaste.paste") this.completedRows.add(row);
    }
  }

  shouldReportMissing(row, col) {
    return this.revealAll || this.completedRows.has(row) || this.visited.has(`${row}:${col}`);
  }

  splice(axis, index, removed, added) {
    const shift = (value) => (value < index ? value : value < index + removed ? null : value + added - removed);
    const move = (row, col) => {
      const value = shift(axis === "row" ? row : col);
      return value === null ? null : { row: axis === "row" ? value : row, col: axis === "col" ? value : col };
    };
    this.visited = new Set(
      [...this.visited].flatMap((key) => {
        const [row, col] = key.split(":").map(Number);
        const next = move(row, col);
        return next ? [`${next.row}:${next.col}`] : [];
      }),
    );
    if (axis === "row") this.completedRows = new Set([...this.completedRows].map(shift).filter((value) => value !== null));
    if (this.active) this.active = move(this.active.row, this.active.col);
  }
}
