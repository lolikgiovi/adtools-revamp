/**
 * Icon for Compare Config tool
 * Database comparison icon
 */

export function getIconSvg() {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <!-- Left Database -->
      <ellipse cx="7" cy="6" rx="4" ry="2"/>
      <path d="M 3 6 L 3 16 Q 3 18 7 18 Q 11 18 11 16 L 11 6"/>
      <!-- Right Database -->
      <ellipse cx="17" cy="6" rx="4" ry="2"/>
      <path d="M 13 6 L 13 16 Q 13 18 17 18 Q 21 18 21 16 L 21 6"/>
      <!-- Comparison Arrows -->
      <path d="M 9 10 L 15 10" stroke-width="1.5"/>
      <path d="M 13 9 L 15 10 L 13 11" fill="currentColor" stroke="none"/>
      <path d="M 15 14 L 9 14" stroke-width="1.5"/>
      <path d="M 11 13 L 9 14 L 11 15" fill="currentColor" stroke="none"/>
    </svg>
  `.trim();
}
