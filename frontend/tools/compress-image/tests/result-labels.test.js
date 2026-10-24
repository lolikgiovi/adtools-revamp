// Failure cases: untouched originals described as lossless encoding, changed encoding
// labels regressing, and queued rows appearing to have a completed method.
import { CompressImage } from "../main.js";

describe("compression result labels", () => {
  it.each([
    [{ originalKept: true, lossy: false }, "Unchanged"],
    [{ originalKept: false, lossy: true }, "Lossy"],
    [{ originalKept: false, lossy: false }, "Lossless"],
    [null, "—"],
  ])("renders the method for %j as %s", (result, expected) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td><button class="ci-select"></button><span class="ci-file-warning"></span>
      <span class="ci-file-state"></span><button class="ci-kept-info"></button>
      <span class="ci-kept-tooltip"></span></td><td class="ci-dimensions"></td>
      <td class="ci-method"></td><td class="ci-after"><span class="ci-output-size"></span>
      <span class="ci-saved"></span></td><td><button class="ci-download"></button></td>`;
    CompressImage.prototype.updateRow.call(
      { isOversized: () => false },
      {
        row,
        result,
        status: result ? "Ready" : "Queued",
        file: { size: 9249 },
        blob: { size: 9249 },
      },
    );
    expect(row.querySelector(".ci-method").textContent).toBe(expected);
  });

  it("describes an untouched JPEG as unchanged in the preview", () => {
    expect(
      CompressImage.prototype.describe({
        result: { originalKept: true, originalWidth: 275, originalHeight: 183 },
      }),
    ).toBe("275 × 183 · Unchanged · original kept");
  });

  // Failure cases: incorrect file-specific threshold, the lossy rule shown for
  // lossless output, help remaining visible after a successful compression.
  it("explains the saving required beside Original kept", () => {
    const tool = new CompressImage();
    tool.container = document.createElement("div");
    tool.container.innerHTML = '<table><tbody class="ci-results"></tbody></table>';
    const item = {
      file: { name: "images.jpeg", size: 9249 },
      blob: { size: 9249 },
      status: "Ready",
      result: { originalKept: true, minimumSavingBytes: 1024 },
    };
    tool.createRow(item);
    const button = item.row.querySelector(".ci-kept-info");
    const tooltip = item.row.querySelector(".ci-kept-tooltip");
    expect(button.hidden).toBe(false);
    expect(button.closest(".ci-select")).toBeNull();
    expect(button.getAttribute("aria-describedby")).toBe(tooltip.id);
    expect(tooltip.textContent).toContain("1,024 bytes");
    expect(tooltip.textContent).toContain("1% or 1,024 bytes, whichever is larger");

    item.result.minimumSavingBytes = 0;
    tool.updateRow(item);
    expect(tooltip.textContent).toContain("did not produce a smaller file");
    expect(tooltip.textContent).not.toContain("1%");

    item.result.originalKept = false;
    tool.updateRow(item);
    expect(button.hidden).toBe(true);
  });
});
