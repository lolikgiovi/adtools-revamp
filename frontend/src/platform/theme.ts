const DARK_THEMES = new Set([
  "dark",
  "dark-grey",
  "dracula",
  "catppuccin-mocha",
  "nord",
  "gruvbox-dark",
  "monokai-pro",
  "palenight",
  "github-dark-hc",
  "cobalt2",
]);

export function initializeTheme(): void {
  let theme = "light";
  try {
    theme = localStorage.getItem("theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
  if (theme !== "light") document.documentElement.classList.add(theme);
  if (DARK_THEMES.has(theme)) document.documentElement.classList.add("dark");
  document.documentElement.setAttribute("data-theme", theme);
}
