// Kafka-style split: local pointer capture, keyboard adjustment, and a responsive ratio.
export function attachPaneResizer(workspace, separator) {
  let ratio = 0.46;
  let pointer = null;
  const minimum = 320;
  const key = "tool:compress-image:split-ratio";
  try {
    const saved = Number(localStorage.getItem(key));
    if (saved > 0 && saved < 1) ratio = saved;
  } catch (_) {
    /* Storage is optional. */
  }
  const metrics = () => {
    const rect = workspace.getBoundingClientRect();
    const gap = Number.parseFloat(getComputedStyle(workspace).columnGap) || 0;
    return { rect, gap, available: rect.width - 4 - gap * 2 };
  };
  const apply = (requested, persist = false) => {
    const { available } = metrics();
    if (matchMedia("(max-width: 960px)").matches || available < minimum * 2) {
      workspace.style.removeProperty("grid-template-columns");
      return;
    }
    const left = Math.max(minimum, Math.min(available - minimum, requested ?? available * ratio));
    ratio = left / available;
    workspace.style.gridTemplateColumns = `${left}px 4px minmax(0, 1fr)`;
    separator.setAttribute("aria-valuemin", String(minimum));
    separator.setAttribute("aria-valuemax", String(Math.floor(available - minimum)));
    separator.setAttribute("aria-valuenow", String(Math.round(left)));
    if (persist) {
      try {
        localStorage.setItem(key, String(ratio));
      } catch (_) {
        /* Storage is optional. */
      }
    }
  };
  const stop = () => {
    const id = pointer;
    pointer = null;
    if (id !== null && separator.hasPointerCapture(id)) separator.releasePointerCapture(id);
    workspace.classList.remove("is-resizing");
  };
  separator.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || matchMedia("(max-width: 960px)").matches) return;
    pointer = event.pointerId;
    separator.setPointerCapture(pointer);
    workspace.classList.add("is-resizing");
    event.preventDefault();
  });
  separator.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointer) return;
    const { rect, gap } = metrics();
    apply(event.clientX - rect.left - gap - 2, true);
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) separator.addEventListener(name, stop);
  separator.addEventListener("keydown", (event) => {
    if (matchMedia("(max-width: 960px)").matches) return;
    const { available } = metrics();
    const current = Number(separator.getAttribute("aria-valuenow"));
    const step = event.shiftKey ? 48 : 16;
    const values = { ArrowLeft: current - step, ArrowRight: current + step, Home: minimum, End: available - minimum };
    if (!(event.key in values)) return;
    event.preventDefault();
    apply(values[event.key], true);
  });
  const observer = new ResizeObserver(() => apply());
  observer.observe(workspace);
  apply();
  return () => {
    stop();
    observer.disconnect();
  };
}
