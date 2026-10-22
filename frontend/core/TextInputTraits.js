const TEXT_ENTRY_SELECTOR = "input, textarea, [contenteditable]";
const NON_TEXT_INPUT_TYPES = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);

const TEXT_INPUT_TRAITS = [
  ["autocomplete", "off"],
  ["autocorrect", "off"],
  ["autocapitalize", "off"],
  ["spellcheck", "false"],
];

function isTextEntry(element) {
  if (!element || element.nodeType !== 1 || typeof element.matches !== "function") return false;
  if (element.matches("textarea")) return true;
  if (element.matches("input")) {
    const type = (element.getAttribute("type") || "text").toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(type);
  }
  const editable = element.getAttribute("contenteditable");
  return editable !== null && editable !== "false";
}

function applyTextInputTraits(element) {
  if (!isTextEntry(element)) return;
  for (const [name, value] of TEXT_INPUT_TRAITS) {
    if (!element.hasAttribute(name)) element.setAttribute(name, value);
  }
}

/**
 * Suppress macOS/WKWebView text assistance (autocorrection bubbles, inline
 * predictions, spellcheck and autofill suggestions) for every text field.
 *
 * Applies to fields already in the DOM, fields added later by tools such as
 * Handsontable, and fields that receive focus before the mutation observer
 * has had a chance to run. Explicit attributes are preserved.
 */
function installTextInputTraits(root = document) {
  root.querySelectorAll?.(TEXT_ENTRY_SELECTOR).forEach(applyTextInputTraits);

  const observeTarget = root.nodeType === 9 ? root.documentElement : root;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        applyTextInputTraits(node);
        node.querySelectorAll?.(TEXT_ENTRY_SELECTOR).forEach(applyTextInputTraits);
      }
    }
  });
  observer.observe(observeTarget, { childList: true, subtree: true });

  const handleFocusIn = (event) => applyTextInputTraits(event.target);
  root.addEventListener("focusin", handleFocusIn, true);

  return () => {
    observer.disconnect();
    root.removeEventListener("focusin", handleFocusIn, true);
  };
}

export { installTextInputTraits };
