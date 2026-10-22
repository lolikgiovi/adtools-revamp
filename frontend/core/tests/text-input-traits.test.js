// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { installTextInputTraits } from "../TextInputTraits.js";

describe("installTextInputTraits", () => {
  it("disables macOS text assistance on existing text inputs", () => {
    document.body.innerHTML = `
      <input id="text" type="text">
      <input id="search" type="search">
      <input id="default">
      <textarea id="notes"></textarea>
    `;

    const uninstall = installTextInputTraits(document);

    for (const id of ["text", "search", "default", "notes"]) {
      const element = document.getElementById(id);
      expect(element.getAttribute("autocomplete")).toBe("off");
      expect(element.getAttribute("autocorrect")).toBe("off");
      expect(element.getAttribute("autocapitalize")).toBe("off");
      expect(element.getAttribute("spellcheck")).toBe("false");
    }

    uninstall();
  });

  it("keeps attributes that were set explicitly", () => {
    document.body.innerHTML = `
      <input id="otp" autocomplete="one-time-code" autocapitalize="characters" spellcheck="true">
      <textarea id="notes" spellcheck="true"></textarea>
    `;

    const uninstall = installTextInputTraits(document);

    const otp = document.getElementById("otp");
    expect(otp.getAttribute("autocomplete")).toBe("one-time-code");
    expect(otp.getAttribute("autocapitalize")).toBe("characters");
    expect(otp.getAttribute("spellcheck")).toBe("true");
    expect(otp.getAttribute("autocorrect")).toBe("off");
    expect(document.getElementById("notes").getAttribute("spellcheck")).toBe("true");

    uninstall();
  });

  it("ignores non-text controls", () => {
    document.body.innerHTML = `
      <input id="checkbox" type="checkbox">
      <input id="hidden" type="hidden">
      <input id="submit" type="submit">
      <input id="range" type="range">
      <button id="button">Go</button>
    `;

    const uninstall = installTextInputTraits(document);

    for (const id of ["checkbox", "hidden", "submit", "range", "button"]) {
      expect(document.getElementById(id).hasAttribute("autocorrect")).toBe(false);
    }

    uninstall();
  });

  it("covers text areas that are added later, like table editors", async () => {
    document.body.innerHTML = "";
    const uninstall = installTextInputTraits(document);

    const editor = document.createElement("textarea");
    editor.className = "handsontableInput";
    document.body.appendChild(editor);
    await Promise.resolve();

    expect(editor.getAttribute("autocorrect")).toBe("off");
    expect(editor.getAttribute("spellcheck")).toBe("false");

    uninstall();
  });

  it("covers an input when it receives focus before the mutation callback runs", () => {
    document.body.innerHTML = "";
    const uninstall = installTextInputTraits(document);

    const editor = document.createElement("textarea");
    editor.id = "late-editor";
    document.body.appendChild(editor);
    editor.focus();

    expect(editor.getAttribute("autocorrect")).toBe("off");
    expect(editor.getAttribute("spellcheck")).toBe("false");

    uninstall();
  });
});
