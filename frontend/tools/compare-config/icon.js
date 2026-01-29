/**
 * Icon for Compare Config tool
 * Database comparison icon
 */

export function getIconSvg() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
      <!-- Bracket-style comparison: [|], kept square in 24x24 -->
      <!-- Left bracket -->
      <path d="M5 5h4 M5 19h4 M5 5v14" />
      <!-- Center divider -->
      <path d="M12 4v16" />
      <!-- Right bracket -->
      <path d="M15 5h4 M15 19h4 M19 5v14" />
    </svg>
  `.trim();
}
