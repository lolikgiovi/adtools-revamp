// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { IndexedDBStorageService } from "../services/IndexedDBStorageService.js";

describe("Run Query history storage", () => {
  it("preserves the IndexedDB key when updating a loaded history entry", async () => {
    const service = new IndexedDBStorageService();
    service._putRecord = vi.fn(async () => true);

    await service.addHistoryEntry({ _id: 7, timestamp: "2026-01-01T00:00:00.000Z", buildNumber: 42 });

    expect(service._putRecord).toHaveBeenCalledWith("history", {
      id: 7,
      timestamp: "2026-01-01T00:00:00.000Z",
      buildNumber: 42,
    });
  });
});
