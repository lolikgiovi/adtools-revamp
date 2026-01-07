export const AboutTemplate = /*html*/ `
  <section class="tutorial-page">
    <header class="tutorial-header">
      <nav class="tutorial-tabs" role="tablist" aria-label="Tutorial categories">
        <!-- Tabs will be rendered dynamically -->
      </nav>
      <div class="tutorial-search-wrapper">
        <svg class="tutorial-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input 
          type="text" 
          id="tutorial-search" 
          class="tutorial-search-input" 
          placeholder="Search tutorials..." 
          aria-label="Search tutorials"
        />
        <div id="tutorial-search-results" class="tutorial-search-results" style="display: none;"></div>
      </div>
    </header>

    <main class="tutorial-content" role="tabpanel" aria-label="Tutorial content">
      <!-- Content will be rendered dynamically -->
    </main>

    <footer class="tutorial-footer">
      <p>© 2025 — <a href="https://linkedin.com/in/fashalli/" target="_blank" rel="noopener">Fashalli Giovi Bilhaq (Lolik)</a></p>
    </footer>
  </section>
`;
