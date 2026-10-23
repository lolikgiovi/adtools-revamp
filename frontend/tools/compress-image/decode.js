// Decoding and resizing for the compression worker. Uses the same browser decoders as
// the <img> path: EXIF orientation applied, color profiles converted to sRGB.

let supported;
export function canDecodeInWorker() {
  if (supported === undefined) {
    try {
      supported =
        typeof createImageBitmap === "function" &&
        typeof OffscreenCanvas === "function" &&
        !!new OffscreenCanvas(1, 1).getContext("2d", { colorSpace: "srgb" });
    } catch {
      supported = false;
    }
  }
  return supported;
}

// premultiplyAlpha "default" matches the <img>-plus-canvas path byte for byte; "none" rounds
// semi-transparent colors differently. One known difference remains: when drawn smaller,
// Chrome's <img> path lets the JPEG decoder scale down during decoding, while this decodes at
// full size and then resamples. Shrunk JPEGs can differ by about 2 per channel.
export async function decodeBitmap(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image", premultiplyAlpha: "default", colorSpaceConversion: "default" });
  } catch {
    throw new Error("This image could not be decoded.");
  }
}

// Draws the bitmap at the target size, like the main-thread canvas path did, and reads the pixels.
export function readPixels(bitmap, target) {
  const canvas = new OffscreenCanvas(target.width, target.height);
  try {
    const context = canvas.getContext("2d", { colorSpace: "srgb" });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, target.width, target.height);
    return context.getImageData(0, 0, target.width, target.height);
  } finally {
    canvas.width = canvas.height = 1;
  }
}

// WebKit can display a PNG whose zlib stream is corrupt, so this complements, not
// replaces, validatePng. It confirms the browser decodes the output at the target size.
export async function checkDisplayable(bytes, type, target) {
  const bitmap = await decodeBitmap(new Blob([bytes], { type })).catch(() => {
    throw new Error("Candidate preview failed to decode.");
  });
  try {
    if (bitmap.width !== target.width || bitmap.height !== target.height) {
      throw new Error("Candidate preview failed dimension verification.");
    }
  } finally {
    bitmap.close();
  }
}
