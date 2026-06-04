/**
 * Theme toggle — light / dark with localStorage + system preference fallback.
 */
(function () {
  const STORAGE_KEY = 'mainframe-mcp-theme';

  function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function getTheme() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return getSystemTheme();
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      toggle.setAttribute('title', theme === 'dark' ? 'Light mode' : 'Dark mode');
    }
  }

  function setTheme(theme) {
    localStorage.setItem(STORAGE_KEY, theme);
    applyTheme(theme);
  }

  function initToggle() {
    const toggle = document.getElementById('theme-toggle');
    if (!toggle) return;
    toggle.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      setTheme(next);
    });
  }

  // Apply on load (head script may have run already; keep in sync)
  applyTheme(getTheme());
  document.addEventListener('DOMContentLoaded', initToggle);

  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (event) => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      applyTheme(event.matches ? 'light' : 'dark');
    }
  });
})();
