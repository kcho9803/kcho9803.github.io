(() => {
  const storageKey = 'site-theme';
  const root = document.documentElement;
  const defaultTheme = 'dark';
  let preference = defaultTheme;

  function readPreference() {
    try {
      const saved = localStorage.getItem(storageKey);
      return ['dark', 'light', 'system'].includes(saved) ? saved : defaultTheme;
    } catch {
      return preference;
    }
  }

  function applyTheme() {
    root.dataset.theme = preference;
  }

  function restoreTheme() {
    preference = readPreference();
    applyTheme();
    const selector = document.getElementById('site-theme');
    if (selector) selector.value = preference;
  }

  restoreTheme();
  window.addEventListener('pagereveal', restoreTheme);
  window.addEventListener('pageshow', restoreTheme);

  document.addEventListener('DOMContentLoaded', () => {
    const selector = document.getElementById('site-theme');
    if (!selector) return;

    selector.value = preference;
    selector.addEventListener('change', () => {
      preference = selector.value;
      applyTheme();

      try {
        localStorage.setItem(storageKey, preference);
      } catch {
        // The selection still applies for this page.
      }
    });
  });
})();
