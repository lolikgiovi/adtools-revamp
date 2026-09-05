#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..", "..");
const defaultContentPath = path.join(projectRoot, "frontend", "config", "release-content.json");
const contentPath = path.resolve(process.argv[2] || process.env.RELEASE_CONTENT_FILE || defaultContentPath);
const publicRoot = path.resolve(projectRoot, "frontend", "public");
const errors = [];
const warnings = [];

function labelPath(label) {
  return label ? `release content ${label}` : "release content";
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${labelPath(label)} must be a non-empty string`);
    return false;
  }
  return true;
}

function validateKeys(value, allowedKeys, label) {
  if (!isRecord(value)) return;
  Object.keys(value).forEach((key) => {
    const fieldLabel = label ? `${label}.${key}` : key;
    if (!allowedKeys.includes(key)) errors.push(`${labelPath(fieldLabel)} is not a supported field`);
  });
}

function isSafeReference(value) {
  const reference = typeof value === "string" ? value.trim() : "";
  if (!reference || /[\u0000-\u001f]/.test(reference)) return false;
  if (/^[a-z][a-z\d+.-]*:/i.test(reference) && !/^https?:\/\//i.test(reference)) return false;
  return !reference.startsWith("//");
}

function isExternalReference(reference) {
  return /^https?:\/\//i.test(reference);
}

function localAssetPath(reference) {
  const clean = reference.replace(/^\.\//, "").replace(/^\//, "");
  const candidate = path.resolve(publicRoot, clean);
  if (candidate !== publicRoot && !candidate.startsWith(`${publicRoot}${path.sep}`)) return null;
  return candidate;
}

function validateReference(value, label, { requireLocal = false, checkReleaseAsset = false } = {}) {
  if (!requireString(value, label)) return;
  const reference = value.trim();
  if (!isSafeReference(reference)) {
    errors.push(`${labelPath(label)} must be a relative path or an http(s) URL`);
    return;
  }
  if (isExternalReference(reference)) {
    if (requireLocal) warnings.push(`${labelPath(label)} uses a remote URL; Desktop previews may be unavailable offline`);
    return;
  }
  if (!requireLocal && !(checkReleaseAsset && reference.includes("release-assets/"))) return;
  const assetPath = localAssetPath(reference);
  if (!assetPath || !fs.existsSync(assetPath)) {
    errors.push(`${labelPath(label)} points to a missing public asset: ${reference}`);
  }
}

function validateMedia(value, label, altValue) {
  if (typeof value === "string") {
    validateReference(value, `${label}.image`, { requireLocal: true });
    requireString(altValue, `${label}.imageAlt`);
    return;
  }
  if (!isRecord(value)) {
    errors.push(`${labelPath(`${label}.image`)} must be a path or object`);
    return;
  }
  validateKeys(value, ["src", "alt", "caption"], `${label}.image`);
  validateReference(value.src, `${label}.image.src`, { requireLocal: true });
  requireString(value.alt, `${label}.image.alt`);
  if (value.caption !== undefined) requireString(value.caption, `${label}.image.caption`);
}

function validateLink(link, label) {
  if (!isRecord(link)) {
    errors.push(`${labelPath(label)} must be an object`);
    return;
  }
  validateKeys(link, ["label", "href", "route", "focus"], label);
  requireString(link.label, `${label}.label`);
  const hasHref = typeof link.href === "string" && link.href.trim();
  const hasRoute = typeof link.route === "string" && link.route.trim();
  if (!hasHref && !hasRoute) {
    errors.push(`${labelPath(label)} needs either href or route`);
  }
  if (link.href !== undefined && !hasHref) requireString(link.href, `${label}.href`);
  if (hasHref) validateReference(link.href, `${label}.href`, { checkReleaseAsset: true });
  if (link.route !== undefined && !hasRoute) requireString(link.route, `${label}.route`);
  if (hasRoute) requireString(link.route, `${label}.route`);
  if (link.focus !== undefined) requireString(link.focus, `${label}.focus`);
}

function validateLinks(value, label) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${labelPath(label)} must be an array`);
    return;
  }
  if (value.length > 2) errors.push(`${labelPath(label)} may contain at most two links`);
  value.forEach((link, index) => validateLink(link, `${label}[${index}]`));
}

function validateAction(value, label) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    errors.push(`${labelPath(label)} must be an object`);
    return;
  }
  validateKeys(value, ["label", "route", "focus"], label);
  requireString(value.label, `${label}.label`);
  requireString(value.route, `${label}.route`);
  if (value.focus !== undefined) requireString(value.focus, `${label}.focus`);
}

function validateSlide(slide, index) {
  const label = `slides[${index}]`;
  if (!isRecord(slide)) {
    errors.push(`${labelPath(label)} must be an object`);
    return;
  }
  validateKeys(slide, ["title", "body", "bullets", "image", "imageAlt", "imageCaption", "links", "action"], label);
  requireString(slide.title, `${label}.title`);
  requireString(slide.body, `${label}.body`);
  if (slide.bullets !== undefined) {
    if (!Array.isArray(slide.bullets)) errors.push(`${labelPath(`${label}.bullets`)} must be an array`);
    else {
      if (slide.bullets.length > 5) errors.push(`${labelPath(`${label}.bullets`)} may contain at most five items`);
      slide.bullets.forEach((bullet, bulletIndex) => requireString(bullet, `${label}.bullets[${bulletIndex}]`));
    }
  }
  if (slide.image !== undefined || slide.media !== undefined) {
    validateMedia(slide.image || slide.media, label, slide.imageAlt || slide.alt);
  }
  if (slide.imageAlt !== undefined && typeof slide.image !== "string") requireString(slide.imageAlt, `${label}.imageAlt`);
  if (slide.imageCaption !== undefined && typeof slide.image !== "string") requireString(slide.imageCaption, `${label}.imageCaption`);
  validateLinks(slide.links || slide.link, `${label}.links`);
  validateAction(slide.action, `${label}.action`);
}

function validateTourStep(step, index) {
  const label = `tour[${index}]`;
  if (!isRecord(step)) {
    errors.push(`${labelPath(label)} must be an object`);
    return;
  }
  validateKeys(step, ["target", "placement", "title", "body"], label);
  requireString(step.target, `${label}.target`);
  requireString(step.title, `${label}.title`);
  requireString(step.body, `${label}.body`);
  if (step.placement !== undefined && !["top", "right", "bottom", "left"].includes(step.placement)) {
    errors.push(`${labelPath(`${label}.placement`)} must be top, right, bottom, or left`);
  }
}

function validateContent(content) {
  if (!isRecord(content)) {
    errors.push("release content must be a JSON object");
    return;
  }

  validateKeys(
    content,
    [
      "$schema",
      "releaseId",
      "version",
      "title",
      "summary",
      "notes",
      "image",
      "imageAlt",
      "imageCaption",
      "links",
      "action",
      "slides",
      "tour",
    ],
    "",
  );

  ["$schema", "releaseId", "version", "title", "summary"].forEach((key) => {
    if (content[key] !== undefined) requireString(content[key], key);
  });
  if (content.$schema !== undefined && content.$schema !== "./release-content.schema.json") {
    errors.push('release content $schema must point to "./release-content.schema.json"');
  }
  if (!content.releaseId) warnings.push("releaseId is missing; every new Web build will be treated as a new release");

  if (content.notes !== undefined && typeof content.notes !== "string" && !Array.isArray(content.notes)) {
    errors.push("release content notes must be a string or array");
  }
  if (Array.isArray(content.notes)) {
    if (content.notes.length > 8) errors.push("release content notes may contain at most eight items");
    content.notes.forEach((note, index) => requireString(note, `notes[${index}]`));
  }
  if (content.imageAlt !== undefined) requireString(content.imageAlt, "imageAlt");
  if (content.imageCaption !== undefined) requireString(content.imageCaption, "imageCaption");

  if (content.image !== undefined || content.media !== undefined) {
    validateMedia(content.image || content.media, "opening slide", content.imageAlt || content.alt);
  }
  validateLinks(content.links || content.link, "links");
  validateAction(content.action, "action");

  if (content.slides !== undefined) {
    if (!Array.isArray(content.slides)) errors.push("release content slides must be an array");
    else {
      if (content.slides.length > 3) errors.push("release content may contain at most three custom slides");
      content.slides.forEach(validateSlide);
    }
  }

  if (content.tour !== undefined) {
    if (!Array.isArray(content.tour)) errors.push("release content tour must be an array");
    else {
      if (content.tour.length > 3) errors.push("release content may contain at most three guided-tour steps");
      content.tour.forEach(validateTourStep);
    }
  }
}

if (!fs.existsSync(contentPath)) {
  errors.push(`release content file not found: ${contentPath}`);
} else {
  try {
    validateContent(JSON.parse(fs.readFileSync(contentPath, "utf8")));
  } catch (error) {
    errors.push(`could not parse ${contentPath}: ${error.message}`);
  }
}

if (warnings.length) {
  warnings.forEach((warning) => console.warn(`WARN: ${warning}`));
}
if (errors.length) {
  errors.forEach((error) => console.error(`ERROR: ${error}`));
  process.exitCode = 1;
} else {
  console.log(`✓ Release content valid: ${contentPath}`);
}
