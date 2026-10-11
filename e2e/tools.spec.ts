import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect.soft(pageErrors.get(page), "No uncaught browser errors").toEqual([]);
});

async function openTool(page: Page, route: string) {
  await page.goto(`/#/${route}`);
  await expect(page.getByRole("main")).not.toContainText("Loading tool…");
}

async function enterJson(page: Page, value: string) {
  const input = page.getByRole("textbox", { name: "JSON input", exact: true });
  await input.focus();
  await input.press("ControlOrMeta+A");
  await page.keyboard.insertText(value);
}

const jsonOutput = (page: Page) => page.locator('.json-monaco-host[aria-label="JSON output"] .view-lines');

// Protects invalid quantities, keyboard generation, automatic copy, and clearing results.
test("UUID quantity validation and keyboard generation", async ({ page }) => {
  await openTool(page, "uuid-generator");
  await page.getByLabel("Quantity", { exact: true }).fill("-3");
  await expect(page.getByText("Enter a whole number from 1 to 10,000.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate", exact: true }).nth(1)).toBeDisabled();
  await page.getByLabel("Quantity", { exact: true }).fill("3");
  await page.getByLabel("Quantity", { exact: true }).press("Enter");
  const results = page.getByLabel("Generated UUIDs", { exact: true });
  await expect(results).toHaveValue(/^[\da-f-]{36}\n[\da-f-]{36}\n[\da-f-]{36}$/);
  const value = await results.inputValue();
  expect(new Set(value.split("\n")).size).toBe(3);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(value);
  await page.getByLabel("Quantity", { exact: true }).fill("1e1");
  await page.getByLabel("Quantity", { exact: true }).press("Enter");
  await expect.poll(async () => (await results.inputValue()).split("\n").length).toBe(10);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(results).toHaveValue("");
});

// Protects summary layout, row counts, and persistence when navigating before debounce completes.
test("character counts and immediate route persistence", async ({ page }) => {
  await openTool(page, "char-counter");
  await page.getByLabel("Text to count", { exact: true }).fill("ab\nx");
  await expect(page.locator(".char-count-primary output")).toHaveText("4");
  await expect(page.locator(".char-counter-summary")).toHaveCSS("display", "grid");
  await page.getByText("Per row", { exact: true }).click();
  await expect(page.locator(".char-counter-rows li")).toHaveCount(2);
  await expect(page.locator(".char-counter-rows strong")).toHaveText(["2", "1"]);
  await page.getByLabel("Text to count", { exact: true }).fill("saved immediately");
  await page.getByRole("link", { name: "UUID Generator", exact: true }).click();
  await page.getByRole("link", { name: "Char Counter", exact: true }).click();
  await expect(page.getByLabel("Text to count", { exact: true })).toHaveValue("saved immediately");
});

test("Base64 encode, decode, and invalid input recovery", async ({ page }) => {
  await openTool(page, "base64-tools");
  await expect(page.getByRole("button", { name: "Encode to Base64", exact: true })).toBeDisabled();
  await page.getByLabel("Input", { exact: true }).fill("Hello");
  await page.getByRole("button", { name: "Encode to Base64", exact: true }).click();
  await expect(page.getByLabel("Base64 Output", { exact: true })).toHaveValue("SGVsbG8=");
  await page.getByRole("tab", { name: "Decode from Base64", exact: true }).click();
  await page.getByLabel("Base64 Input", { exact: true }).fill("SGVsbG8=");
  await page.getByRole("button", { name: "Decode from Base64", exact: true }).click();
  await expect(page.getByLabel("Decoded Output", { exact: true })).toHaveValue("Hello");
  await page.getByLabel("Base64 Input", { exact: true }).fill("!invalid!");
  await page.getByRole("button", { name: "Decode from Base64", exact: true }).click();
  await expect(page.getByLabel("Decoded Output", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Download", exact: true })).toBeDisabled();
});

// Removing input files after processing must not alter the files offered for download.
test("Base64 downloads the processed output after clearing input files", async ({ page }) => {
  await openTool(page, "base64-tools");
  await page.locator('input[type="file"]').setInputFiles([
    { name: "first.txt", mimeType: "text/plain", buffer: Buffer.from("first") },
    { name: "second.txt", mimeType: "text/plain", buffer: Buffer.from("second") },
  ]);
  await page.getByRole("button", { name: "Encode to Base64", exact: true }).click();
  await expect(page.getByRole("region", { name: "Processed files" }).getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: "Clear", exact: true }).first().click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download All", exact: true }).click();
  const download = await downloadPromise;
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await readFile((await download.path())!));
  expect(await zip.file("first.txt")!.async("string")).toContain("Zmlyc3Q=");
  expect(await zip.file("second.txt")!.async("string")).toContain("c2Vjb25k");
});

test("decoded text files support copying and preview dialog keyboard dismissal", async ({ page }) => {
  await openTool(page, "base64-tools");
  await page.getByRole("tab", { name: "Decode from Base64", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "message.base64",
    mimeType: "text/plain",
    buffer: Buffer.from("SGVsbG8="),
  });
  await page.getByRole("button", { name: "Decode from Base64", exact: true }).click();
  const files = page.getByRole("region", { name: "Processed files" });
  await files.getByRole("button", { name: "Copy", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("Hello");
  await files.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "message.txt", exact: true })).toContainText("Hello");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "message.txt", exact: true })).toBeHidden();
  await expect(files.getByRole("button", { name: "Preview", exact: true })).toBeFocused();
});

test("JSON extraction options update the existing result", async ({ page }) => {
  await openTool(page, "json-tools");
  await enterJson(page, '{"z":1,"nested":{"a":2}}');
  await page.getByRole("tab", { name: "Extract Keys", exact: true }).click();
  await page.getByRole("button", { name: "Extract Keys", exact: true }).click();
  await expect(jsonOutput(page)).toContainText('"a"');
  await page.getByLabel("Key type", { exact: true }).click();
  await page.getByRole("option", { name: "Key Paths", exact: true }).click();
  await expect(jsonOutput(page)).toContainText('"nested.a"');
  await page.getByLabel("Sort", { exact: true }).click();
  await page.getByRole("option", { name: "A-Z", exact: true }).click();
  await expect.poll(async () => (await jsonOutput(page).innerText()).replace(/\s/g, "")).toBe('["nested","nested.a","z"]');
  await page.getByRole("tab", { name: "Minify", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copy", exact: true }).last()).toBeDisabled();
});

test("JSON table sorting and search are keyboard accessible", async ({ page }) => {
  await openTool(page, "json-tools");
  await enterJson(page, '{"z":"last","a":"first"}');
  await page.getByRole("tab", { name: "To Table", exact: true }).click();
  await page.getByRole("button", { name: "Convert to Table", exact: true }).click();
  const sort = page.getByRole("button", { name: "Sort keys", exact: true });
  await sort.focus();
  await sort.press("Enter");
  await expect(page.locator("th[aria-sort]")).toHaveAttribute("aria-sort", "ascending");
  await expect(sort).toBeFocused();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const search = page.getByRole("textbox", { name: "Search in table", exact: true });
  await expect(search).toBeFocused();
  await search.fill("no-such-value");
  await expect(page.getByText("0 matches", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next match", exact: true })).toBeDisabled();
  await search.fill("first");
  await expect(page.getByText("1/1", { exact: true })).toBeVisible();
  await search.press("Escape");
  await expect(search).toBeHidden();
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeFocused();
  await enterJson(page, "null");
  await expect(page.getByRole("table")).toBeHidden();
  await page.getByRole("button", { name: "Convert to Table", exact: true }).click();
  const exportPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Excel", exact: true }).click();
  expect((await exportPromise).suggestedFilename()).toMatch(/\.xlsx$/);
});

test("TLV sample views, parsing shortcut, and error recovery", async ({ page }) => {
  await openTool(page, "tlv-viewer");
  await page.getByRole("button", { name: "BER-TLV Sample", exact: true }).click();
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("cell", { name: "6F", exact: true })).toBeVisible();
  const input = page.getByLabel("Paste QRIS string, hex TLV, or base64 payload", { exact: true });
  await input.fill("invalid hex");
  await input.press("ControlOrMeta+Enter");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "QRIS Sample", exact: true }).click();
  await expect(input).toHaveAttribute("aria-invalid", "false");
  await expect(page.getByText(/181 chars/)).toBeVisible();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copy", exact: true })).toBeDisabled();
});

test("QR downloads wait for current preview and reset preserves defaults", async ({ page }) => {
  await openTool(page, "qr-tools");
  const png = page.getByRole("button", { name: "Download PNG", exact: true });
  await expect(png).toBeDisabled();
  await page.getByLabel("Content", { exact: true }).fill("Hello QR");
  await expect(png).toBeEnabled();
  const before = await page.locator("canvas").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.getByLabel("Content", { exact: true }).fill("Hello QR");
  await expect(png).toBeEnabled();
  expect(await page.locator("canvas").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(before);
  const downloadPromise = page.waitForEvent("download");
  await png.click();
  expect((await downloadPromise).suggestedFilename()).toBe("qr-code.png");
  await page.getByLabel("Content Type", { exact: true }).click();
  await page.getByRole("option", { name: "URL", exact: true }).click();
  await expect(page.getByLabel("Content", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(png).toBeDisabled();
  await page.getByLabel("Content Type", { exact: true }).click();
  await page.getByRole("option", { name: "Text", exact: true }).click();
  await page.getByLabel("Content", { exact: true }).fill("x".repeat(6000));
  await expect(page.getByText("Unable to generate this code. Try shorter content.", { exact: true })).toBeVisible();
  await expect(png).toBeDisabled();
});

for (const route of ["uuid-generator", "char-counter", "base64-tools", "json-tools", "tlv-viewer", "qr-tools"]) {
  test(`${route} fits the desktop workspace`, async ({ page }, testInfo) => {
    await openTool(page, route);
    // Long content must stay within the tool pane instead of widening the document.
    if (route === "char-counter") await page.getByLabel("Text to count", { exact: true }).fill("x".repeat(1000));
    if (route === "tlv-viewer") await page.getByRole("button", { name: "QRIS Sample", exact: true }).click();
    if (route === "qr-tools") {
      await page.getByLabel("Content", { exact: true }).fill("https://example.com");
      await expect(page.getByRole("button", { name: "Download PNG", exact: true })).toBeEnabled();
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    if (["char-counter", "json-tools", "tlv-viewer", "qr-tools"].includes(route)) {
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(1);
    }
    // Regression: percentage-height tab triggers overflowed a wrapped list at half width.
    for (const list of await page.getByRole("tablist").all()) {
      const bounds = await list.boundingBox();
      expect(bounds).not.toBeNull();
      for (const tab of await list.getByRole("tab").all()) {
        const child = await tab.boundingBox();
        expect(child).not.toBeNull();
        expect(child!.y).toBeGreaterThanOrEqual(bounds!.y - 1);
        expect(child!.y + child!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height + 1);
      }
    }
    const screenshot = await page.screenshot({ path: testInfo.outputPath(`${route}.png`), fullPage: true });
    await testInfo.attach(route, { body: screenshot, contentType: "image/png" });
  });
}

// Protects cross-tool sizing: a local size/font override must not drift from the shared control scale.
test("tools use one control and tab sizing scale", async ({ page }) => {
  for (const route of ["uuid-generator", "base64-tools", "json-tools", "char-counter", "tlv-viewer", "qr-tools"]) {
    await openTool(page, route);
    const metrics = await page.locator("main").evaluate((main) => {
      const measure = (selector: string) =>
        Array.from(main.querySelectorAll<HTMLElement>(selector))
          .filter((node) => node.getBoundingClientRect().height > 0)
          .map((node) => ({ font: parseFloat(getComputedStyle(node).fontSize), height: node.getBoundingClientRect().height }));
      return {
        padding: [getComputedStyle(main).paddingLeft, getComputedStyle(main).paddingRight],
        controls: measure('[data-slot="button"], [data-slot="input"], [data-slot="select-trigger"], [data-slot="toggle-group-item"]'),
        tabs: measure('[data-slot="tabs-trigger"]'),
      };
    });
    expect(metrics.padding).toEqual(["21.6px", "21.6px"]);
    expect(metrics.controls.length).toBeGreaterThan(0);
    for (const item of [...metrics.controls, ...metrics.tabs]) {
      expect(item.font, `${route}: control font`).toBeCloseTo(12.6, 1);
      expect(item.height, `${route}: control height`).toBeCloseTo(28.8, 1);
    }
  }
});
