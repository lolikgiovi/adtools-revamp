const segmenters = new Map();

function getSegmenter(granularity) {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    if (!segmenters.has(granularity)) {
      segmenters.set(granularity, new Intl.Segmenter(undefined, { granularity }));
    }
    return segmenters.get(granularity);
  }

  return null;
}

function countSegments(text, granularity) {
  const segmenter = getSegmenter(granularity);
  return segmenter ? Array.from(segmenter.segment(text)) : null;
}

function countCharacters(text) {
  const value = String(text || "");
  const segments = countSegments(value, "grapheme");
  return segments ? segments.length : Array.from(value).length;
}

function countWords(text) {
  const value = String(text || "").trim();
  if (!value) return 0;

  const segments = countSegments(value, "word");
  if (segments) return segments.filter((segment) => segment.isWordLike).length;

  return (value.match(/[\p{L}\p{M}\p{N}]+(?:['’_-][\p{L}\p{M}\p{N}]+)*/gu) || []).length;
}

function countUtf8Bytes(text) {
  const value = String(text || "");
  if (typeof TextEncoder === "function") return new TextEncoder().encode(value).length;

  return unescape(encodeURIComponent(value)).length;
}

export function getTextCounts(text) {
  const value = String(text || "");
  const withoutWhitespace = value.replace(/\s/gu, "");

  return {
    characters: countCharacters(value),
    charactersNoSpaces: countCharacters(withoutWhitespace),
    words: countWords(value),
    lines: value ? value.split(/\r\n|\r|\n/u).length : 0,
    bytes: countUtf8Bytes(value),
  };
}

export function getLineCounts(text) {
  const value = String(text || "");
  if (!value) return [];

  return value.split(/\r\n|\r|\n/u).map((content, index) => ({
    line: index + 1,
    content,
    characters: countCharacters(content),
  }));
}
