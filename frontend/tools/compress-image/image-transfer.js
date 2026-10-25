export const imageAttachmentType = (file) => {
  const content = file.processedFormats?.base64 || "";
  if (!/^data:[^,]*;base64,/i.test(content)) return "";
  const dataType = /^data:(image\/(?:png|jpeg|webp));base64,/i.exec(content)?.[1];
  const mime = /^(image\/(?:png|jpeg|webp))$/i.exec(file.type || "")?.[1];
  const ext = file.name?.split(".").at(-1).toLowerCase();
  return (dataType || mime || { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" }[ext] || "").toLowerCase();
};
export function attachmentToImage(file) {
  const type = imageAttachmentType(file);
  if (!type) throw new Error(`No image content available for ${file.name}.`);
  const binary = atob(file.processedFormats.base64.split(",")[1]);
  return new File([Uint8Array.from(binary, (character) => character.charCodeAt(0))], file.name, { type });
}
export function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Unable to read image."));
    reader.readAsDataURL(blob);
  });
}
export function uniqueImageName(name, names) {
  const safe = name.replace(/[\\/\p{Cc}]/gu, "_") || "image";
  const dot = safe.lastIndexOf(".");
  const base = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : "";
  let result = safe;
  let suffix = 2;
  while (names.has(result.toLowerCase())) result = `${base} (${suffix++})${ext}`;
  names.add(result.toLowerCase());
  return result;
}
