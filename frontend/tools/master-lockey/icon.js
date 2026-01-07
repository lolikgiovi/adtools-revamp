export const getIconSvg = () => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <!-- Magnifying glass lens with globe inside -->
  <circle cx="10" cy="10" r="7"/>
  
  <!-- Globe pattern inside lens -->
  <path d="M10 3v14" stroke-width="1.5"/>
  <path d="M3 10h14" stroke-width="1.5"/>
  <ellipse cx="10" cy="10" rx="3" ry="7" stroke-width="1.5"/>
  
  <!-- Magnifying glass handle (diagonal to right) -->
  <path d="M15 15l6 6" stroke-width="2.5"/>
</svg>
`;
