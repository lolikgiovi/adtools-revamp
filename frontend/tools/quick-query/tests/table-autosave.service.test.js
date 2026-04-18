import { afterEach, describe, expect, it, vi } from "vitest";
import { TableAutosaveService } from "../services/TableAutosaveService.js";

function createService(save = vi.fn().mockResolvedValue(true)) {
  return new TableAutosaveService({
    delayMs: 800,
    save,
    onError: vi.fn(),
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("TableAutosaveService", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not write before the debounce delay expires", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(true);
    const service = createService(save);

    service.schedule("schema.table", [["ID"], ["1"]]);

    await vi.advanceTimersByTimeAsync(799);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("schema.table", [["ID"], ["1"]]);
  });

  it("coalesces rapid schedules into one write with the latest data", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(true);
    const service = createService(save);

    service.schedule("schema.table", [["ID"], ["1"]]);
    await vi.advanceTimersByTimeAsync(400);
    service.schedule("schema.table", [["ID"], ["2"]]);

    await vi.advanceTimersByTimeAsync(799);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("schema.table", [["ID"], ["2"]]);
  });

  it("clones scheduled table data so later source mutation does not affect the saved snapshot", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(true);
    const service = createService(save);
    const tableData = [["ID"], ["1"]];

    service.schedule("schema.table", tableData);
    tableData[1][0] = "mutated";

    await vi.advanceTimersByTimeAsync(800);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("schema.table", [["ID"], ["1"]]);
  });

  it("flush writes immediately and clears the pending timer", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(true);
    const service = createService(save);

    service.schedule("schema.table", [["ID"], ["1"]]);
    await service.flush();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("schema.table", [["ID"], ["1"]]);

    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("serializes writes so newer data waits for an in-flight write", async () => {
    vi.useFakeTimers();
    const firstWrite = deferred();
    const save = vi.fn().mockImplementationOnce(() => firstWrite.promise).mockResolvedValueOnce(true);
    const service = createService(save);

    service.schedule("schema.table", [["ID"], ["1"]]);
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);

    service.schedule("schema.table", [["ID"], ["2"]]);
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);

    firstWrite.resolve(true);
    await service.flush();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(1, "schema.table", [["ID"], ["1"]]);
    expect(save).toHaveBeenNthCalledWith(2, "schema.table", [["ID"], ["2"]]);
  });

  it("cancel clears pending data without writing", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(true);
    const service = createService(save);

    service.schedule("schema.table", [["ID"], ["1"]]);
    service.cancel();

    await vi.advanceTimersByTimeAsync(800);
    expect(save).not.toHaveBeenCalled();
  });
});
