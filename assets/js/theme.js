(() => {
  const storageKey = 'site-theme';
  const root = document.documentElement;
  let preference = 'system';

  function readPreference() {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved === 'light' || saved === 'dark' ? saved : 'system';
    } catch {
      return preference;
    }
  }

  function applyTheme() {
    if (preference === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', preference);
    }
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
        if (preference === 'system') {
          localStorage.removeItem(storageKey);
        } else {
          localStorage.setItem(storageKey, preference);
        }
      } catch {
        // The selection still applies for this page.
      }
    });
  });
})();
