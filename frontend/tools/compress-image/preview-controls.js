// All transforms use viewport fractions, so different pane sizes stay visually linked.
export function attachPreviewControls({ preview, zoomInput, zoomValue, fit, splitInput }) {
  const images = preview.querySelectorAll("img");
  const cursors = preview.querySelectorAll(".ci-cursor");
  const divider = preview.querySelector(".ci-divider");
  let zoom = 1,
    x = 0,
    y = 0;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const update = () => {
    const bound = (zoom - 1) / 2;
    x = clamp(x, -bound, bound);
    y = clamp(y, -bound, bound);
    images.forEach((image) => {
      image.style.transform = `translate(${x * 100}%, ${y * 100}%) scale(${zoom})`;
    });
    zoomInput.value = String(zoom);
    zoomValue.textContent = zoom === 1 ? "Fit" : `${Number(zoom.toFixed(2))}×`;
  };
  const zoomAt = (value, anchorX = 0, anchorY = 0) => {
    const next = clamp(value, 1, 8),
      scale = next / zoom;
    x = anchorX - (anchorX - x) * scale;
    y = anchorY - (anchorY - y) * scale;
    zoom = next;
    update();
  };
  zoomInput.addEventListener("input", () => zoomAt(Number(zoomInput.value)));
  fit.addEventListener("click", () => {
    x = y = 0;
    zoomAt(1);
  });
  preview.querySelectorAll(".ci-viewport").forEach((pane) => {
    const pointers = new Map();
    const location = (event) => {
      const rect = pane.getBoundingClientRect();
      return { x: (event.clientX - rect.left) / rect.width - 0.5, y: (event.clientY - rect.top) / rect.height - 0.5 };
    };
    const shape = () => {
      const [a, b] = [...pointers.values()];
      return b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) } : a;
    };
    pane.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest(".ci-divider")) return;
      pointers.set(event.pointerId, { ...location(event), clientX: event.clientX, clientY: event.clientY });
      pane.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    pane.addEventListener("pointermove", (event) => {
      const point = location(event);
      if (pointers.has(event.pointerId)) {
        const before = shape();
        pointers.set(event.pointerId, { ...point, clientX: event.clientX, clientY: event.clientY });
        const after = shape();
        if (pointers.size >= 2 && before.distance > 0) zoomAt((zoom * after.distance) / before.distance, before.x, before.y);
        x += after.x - before.x;
        y += after.y - before.y;
        update();
      }
      cursors.forEach((cursor) => {
        cursor.hidden = event.pointerType === "touch";
        cursor.style.left = `${clamp(point.x + 0.5, 0, 1) * 100}%`;
        cursor.style.top = `${clamp(point.y + 0.5, 0, 1) * 100}%`;
      });
    });
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
      pane.addEventListener(name, (event) => {
        pointers.delete(event.pointerId);
      });
    }
    pane.addEventListener("pointerleave", () =>
      cursors.forEach((cursor) => {
        cursor.hidden = true;
      }),
    );
    pane.addEventListener(
      "wheel",
      (event) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        const anchor = location(event);
        zoomAt(zoom * Math.exp(-event.deltaY * 0.01), anchor.x, anchor.y);
      },
      { passive: false },
    );
    let gestureZoom = 1;
    pane.addEventListener("gesturestart", (event) => {
      event.preventDefault();
      gestureZoom = zoom;
    });
    pane.addEventListener("gesturechange", (event) => {
      event.preventDefault();
      if (pointers.size < 2) zoomAt(gestureZoom * event.scale);
    });
    pane.addEventListener("keydown", (event) => {
      if (event.target.closest(".ci-divider")) return;
      const delta = { ArrowLeft: [0.1, 0], ArrowRight: [-0.1, 0], ArrowUp: [0, 0.1], ArrowDown: [0, -0.1] }[event.key];
      if (delta) {
        event.preventDefault();
        x += delta[0];
        y += delta[1];
        update();
      }
      if (["+", "=", "-"].includes(event.key)) {
        event.preventDefault();
        zoomAt(zoom + (event.key === "-" ? -0.25 : 0.25));
      }
    });
  });
  const split = (value) => {
    const percent = clamp(Number(value), 0, 100);
    splitInput.value = String(percent);
    preview.querySelector(".ci-reveal").style.clipPath = `inset(0 0 0 ${percent}%)`;
    divider.style.left = `${percent}%`;
    divider.setAttribute("aria-valuenow", String(Math.round(percent)));
  };
  splitInput.addEventListener("input", () => split(splitInput.value));
  let dividerPointer = null;
  const moveDivider = (event) => {
    const rect = divider.parentElement.getBoundingClientRect();
    split(((event.clientX - rect.left) / rect.width) * 100);
  };
  divider.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dividerPointer = event.pointerId;
    divider.setPointerCapture(event.pointerId);
    moveDivider(event);
  });
  divider.addEventListener("pointermove", (event) => {
    if (event.pointerId === dividerPointer) moveDivider(event);
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
    divider.addEventListener(name, () => {
      dividerPointer = null;
    });
  divider.addEventListener("keydown", (event) => {
    const values = { ArrowLeft: Number(splitInput.value) - 1, ArrowRight: Number(splitInput.value) + 1, Home: 0, End: 100 };
    if (!(event.key in values)) return;
    event.preventDefault();
    event.stopPropagation();
    split(values[event.key]);
  });
  split(splitInput.value);
  update();
}
