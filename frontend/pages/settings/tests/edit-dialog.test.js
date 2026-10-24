// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { mountEditDialog } from "../edit-dialog.js";

// Failure cases: accidental dismiss during saving, lost focus after closing,
// stale secret drafts on cancellation, and an open dialog surviving page teardown.
beforeEach(() => {
  document.body.innerHTML =
    '<button id="edit">Edit</button><section><form><input type="password"><button type="button">Cancel</button></form></section>';
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

it("routes Escape through cancellation, blocks it while saving, and restores focus", async () => {
  const root = document.querySelector("section");
  const form = root.querySelector("form");
  const trigger = document.querySelector("#edit");
  let busy = false;
  const cancel = vi.fn(() => {
    form.reset();
    modal.close();
  });
  const modal = mountEditDialog({ root, form, onCancel: cancel, isBusy: () => busy });
  trigger.focus();
  modal.open("Edit password");
  expect(root.querySelector("dialog").getAttribute("aria-labelledby")).toBeTruthy();
  form.querySelector("input").value = "draft";
  busy = true;
  root.querySelector("dialog").dispatchEvent(new Event("cancel", { cancelable: true }));
  expect(cancel).not.toHaveBeenCalled();
  busy = false;
  root.querySelector("dialog").dispatchEvent(new Event("cancel", { cancelable: true }));
  await Promise.resolve();
  expect(cancel).toHaveBeenCalledOnce();
  expect(form.querySelector("input").value).toBe("");
  expect(document.activeElement).toBe(trigger);
  modal.open("Edit password");
  modal.dispose();
  expect(root.querySelector("dialog")).toBeNull();
});
