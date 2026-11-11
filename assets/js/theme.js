(() => {
  const storageKey = 'site-theme';
  const root = document.documentElement;
  let preference = 'system';

  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch {
    // The system setting still works when storage is unavailable.
  }

  function applyTheme() {
    if (preference === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', preference);
    }
  }

  applyTheme();

  document.addEventListener('DOMContentLoaded', () => {
    const selector = document.getElementById('site-theme');
    if (!selector) return;

    selector.value = preference;
    selector.hidden = false;
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
