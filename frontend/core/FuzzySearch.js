/**
 * Shared fuzzy search primitives used by the command palette and Quick Query.
 * Matching is intentionally deterministic: exact abbreviations rank first,
 * followed by prefixes, contains matches, and subsequences.
 */

function normalize(value) {
  return String(value || "").toLowerCase();
}

/** Collapse display separators so names such as "Quick Query" can match "quickquery". */
export function collapseSearchName(value) {
  return normalize(value).replace(/[^a-z0-9_$#]/g, "");
}

/** Return true when every character in term occurs in order inside text. */
export function isSubsequence(term, text) {
  if (!term || !text) return false;

  const q = normalize(term);
  const t = normalize(text);
  let index = 0;

  for (const character of t) {
    if (character === q[index]) {
      index += 1;
      if (index === q.length) return true;
    }
  }

  return false;
}

/**
 * Score one searchable value using Quick Query's matching order.
 *
 * `abbrs` lets callers provide domain-specific abbreviations while
 * `collapsed` lets names choose their own separator normalization.
 */
export function scoreFuzzyTerm(term, { name, abbrs = [], collapsed } = {}) {
  const q = normalize(term).trim();
  if (!q) return 0;

  const nm = normalize(name);
  const cl = normalize(typeof collapsed === "undefined" ? collapseSearchName(name) : collapsed);
  const compactQ = q.replace(/[\s-]+/g, "");
  const terms = compactQ && compactQ !== q ? [q, compactQ] : [q];
  const normalizedAbbreviations = abbrs.map((abbr) => normalize(abbr));
  let score = 0;

  terms.forEach((candidate) => {
    if (normalizedAbbreviations.some((abbr) => abbr === candidate)) score = Math.max(score, 100);
    if (normalizedAbbreviations.some((abbr) => abbr.startsWith(candidate))) score = Math.max(score, 90);
    if (nm.startsWith(candidate)) score = Math.max(score, 85);
    if (nm.includes(candidate)) score = Math.max(score, 75);
    if (cl.startsWith(candidate)) score = Math.max(score, 80);
    if (cl.includes(candidate)) score = Math.max(score, 70);
    if (candidate.length >= 3 && isSubsequence(candidate, cl)) score = Math.max(score, 60);
  });

  return score;
}

/**
 * Generate useful abbreviations for display names made up of words.
 * For example, "Quick Query" produces "qq", while "Compare Config"
 * produces "cc" and prefix/consonant variants.
 */
export function getSearchAbbreviations(value) {
  const words = normalize(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return [];

  const abbreviations = new Set();
  const initials = words.map((word) => word[0]).join("");
  if (initials) abbreviations.add(initials);

  words.forEach((word, index) => {
    const prefix = words
      .slice(0, index)
      .map((part) => part[0])
      .join("");
    const maxLength = Math.min(4, word.length);

    for (let length = 1; length <= maxLength; length += 1) {
      abbreviations.add(index === 0 ? word.slice(0, length) : prefix + word.slice(0, length));
    }

    const consonants = word.replace(/[aeiou]/g, "");
    if (consonants) abbreviations.add(index === 0 ? consonants : prefix + consonants);
  });

  const firstWord = words[0];
  if (firstWord.startsWith("config")) abbreviations.add("cfg");
  if (firstWord.startsWith("temp")) abbreviations.add("tmp");
  if (firstWord.startsWith("database")) abbreviations.add("db");

  return Array.from(abbreviations);
}
