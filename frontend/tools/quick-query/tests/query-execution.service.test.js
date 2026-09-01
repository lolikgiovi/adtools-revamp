import { describe, expect, it, vi } from "vitest";
import { QueryExecutionService } from "../services/QueryExecutionService.js";

const request = {
  tableName: "app.users",
  queryType: "insert",
  schemaData: [["id", "NUMBER", "No", "", "", "Yes"]],
  inputData: [["id"], ["1"]],
};

function dependencies() {
  return {
    validationService: { validateSchema: vi.fn(), matchSchemaWithData: vi.fn() },
    queryService: {
      generateQuery: vi.fn(() => "INSERT SQL"),
      detectDuplicatePrimaryKeys: vi.fn(() => ({ hasDuplicates: false })),
    },
  };
}

describe("QueryExecutionService", () => {
  it("normalizes direct generation behind the execution interface", async () => {
    const deps = dependencies();
    const execution = new QueryExecutionService({ ...deps, workerRowThreshold: 1000 });

    await expect(execution.generateQuery(request)).resolves.toEqual({
      sql: "INSERT SQL",
      duplicateResult: { hasDuplicates: false },
      rowCount: 1,
      usedWorker: false,
    });
    expect(deps.validationService.validateSchema).toHaveBeenCalledWith(request.schemaData, request.tableName);
  });

  it("normalizes worker progress and results behind the same interface", async () => {
    const deps = dependencies();
    const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null };
    const onProgress = vi.fn();
    const execution = new QueryExecutionService({ ...deps, workerFactory: () => worker, workerRowThreshold: 1 });
    const resultPromise = execution.generateQuery({ ...request, onProgress });
    const { requestId } = worker.postMessage.mock.calls[0][0];

    worker.onmessage({ data: { type: "progress", requestId, percent: 50, message: "Halfway" } });
    worker.onmessage({
      data: { type: "complete", requestId, sql: "WORKER SQL", duplicateResult: { hasDuplicates: false }, rowCount: 1 },
    });

    expect(onProgress).toHaveBeenCalledWith(50, "Halfway");
    await expect(resultPromise).resolves.toEqual({
      sql: "WORKER SQL",
      duplicateResult: { hasDuplicates: false },
      rowCount: 1,
      usedWorker: true,
    });
  });
});
