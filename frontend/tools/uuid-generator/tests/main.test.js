// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { UUIDGenerator } from "../main.js";

describe("UUIDGenerator", () => {
  it("copies generated multiple UUIDs and shows the success toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const eventBus = { emit: vi.fn() };
    const generator = new UUIDGenerator(eventBus);
    const quantityInput = document.createElement("input");
    quantityInput.id = "uuidQuantity";
    quantityInput.value = "2";
    const resultTextarea = document.createElement("textarea");
    resultTextarea.id = "multipleUuidResult";
    const generateButton = document.createElement("button");
    generateButton.id = "generateMultipleUUID";
    const copyButton = document.createElement("button");
    copyButton.id = "copyMultipleUUID";
    document.body.append(quantityInput, resultTextarea, generateButton, copyButton);

    const uuids = ["uuid-one", "uuid-two"];
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => uuids.shift());

    generator.bindToolEvents();
    generateButton.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());

    expect(resultTextarea.value).toBe("uuid-one\nuuid-two");
    expect(writeText).toHaveBeenCalledWith("uuid-one\nuuid-two");
    expect(eventBus.emit).toHaveBeenCalledWith("notification:success", {
      message: "Copied to clipboard!",
      duration: 2500,
    });
  });
});
