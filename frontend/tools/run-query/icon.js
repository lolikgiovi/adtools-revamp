export function getIconSvg() {
  return `
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <!-- Database cylinder -->
    <ellipse cx="10" cy="5" rx="7" ry="2.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
    <path d="M3 5v10c0 1.38 3.13 2.5 7 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M17 5v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M3 10c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5" stroke="currentColor" stroke-width="1.5"/>
    <!-- Play button -->
    <circle cx="17" cy="17" r="5" stroke="currentColor" stroke-width="1.5" fill="none"/>
    <path d="M15.5 15v4l3.5-2z" fill="currentColor"/>
  </svg>`;
}
