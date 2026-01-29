/**
 * Icon for Merge SQL tool
 * SQL merge/combine icon
 */

export function getIconSvg() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
      <!-- Multiple files merging into one -->
      <path d="M8 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
      <path d="M16 4h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M12 2v20" />
      <path d="M9 9l3 3-3 3" />
      <path d="M15 9l-3 3 3 3" />
    </svg>
  `.trim();
}
