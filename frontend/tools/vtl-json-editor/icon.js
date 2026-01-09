/**
 * VTL JSON Editor Icon
 * SVG icon for the tool (code/template themed)
 */

export function getIconSvg() {
  return /* html */ `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <!-- Document base -->
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14,2 14,8 20,8"/>
      <!-- VTL brackets -->
      <path d="M8 13l-2 2 2 2"/>
      <path d="M16 13l2 2-2 2"/>
      <!-- JSON curly -->
      <path d="M10 12h4"/>
    </svg>
  `;
}
