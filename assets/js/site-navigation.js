(() => {
  const masthead = document.querySelector('.masthead');
  const main = document.querySelector('#main.site-main');
  if (!masthead || !main) return;

  const links = [...masthead.querySelectorAll('.site-nav__links a[href]')];
  const paths = new Set(links.filter(link => link.origin === location.origin)
    .map(link => link.pathname));
  if (!paths.has(location.pathname)) return;

  const metadataSelector = 'link[rel="canonical"], meta[name="description"], ' +
    'meta[property^="og:"], meta[name^="twitter:"]';
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const menu = masthead.querySelector('.site-menu');
  const parser = new DOMParser();
  const pages = new Map();

  function readPage(doc) {
    const area = doc.querySelector('#main.site-main');
    const article = area?.querySelector(':scope > article.page');
    if (!article || area.className !== main.className || !doc.title ||
        doc.querySelector('#main script, #main iframe, head script[async]')) return null;

    const hero = area.querySelector(':scope > .research-hero');
    return {
      article,
      hero,
      title: doc.title,
      metadata: [...doc.head.querySelectorAll(metadataSelector)]
    };
  }

  let currentPath = location.pathname;
  let current = readPage(document);
  if (!current) return;
  pages.set(currentPath, current);

  let request;
  let animations = [];

  function cancelAnimations() {
    for (const animation of animations) animation.cancel();
    animations = [];
  }

  function cancelNavigation() {
    request?.abort();
    request = undefined;
    cancelAnimations();
  }

  function fade(from, to, duration, fill) {
    if (motion.matches || !current.article.animate) return Promise.resolve();
    const regions = current.hero ? [current.article, current.hero] : [current.article];
    animations = regions.map(region => region.animate([{ opacity: from }, { opacity: to }], {
      duration, fill, easing: 'ease-out'
    }));
    return Promise.all(animations.map(animation => animation.finished.catch(() => {})));
  }

  function showPage(page, path, scrollToTop) {
    cancelAnimations();
    current.article.replaceWith(page.article);
    current.hero?.remove();
    if (page.hero) main.prepend(page.hero);
    current = page;
    currentPath = path;

    document.title = page.title;
    document.head.querySelectorAll(metadataSelector).forEach(element => element.remove());
    document.head.append(...page.metadata);
    for (const link of links) {
      if (link.pathname === path && link.origin === location.origin) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    }
    if (menu) menu.open = false;

    const heading = (page.hero ?? page.article).querySelector('h1');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
    if (scrollToTop) window.scrollTo(0, 0);
    document.dispatchEvent(new Event('site:page-change'));
    void fade(.45, 1, 130, 'backwards');
  }

  async function loadPage(url, signal) {
    const saved = pages.get(url.pathname);
    if (saved) return saved;

    const response = await fetch(url, { signal, mode: 'same-origin' });
    const destination = new URL(response.url);
    if (!response.ok || destination.origin !== url.origin || destination.pathname !== url.pathname ||
        !response.headers.get('content-type')?.includes('text/html')) {
      throw new Error('Unexpected page response');
    }
    const page = readPage(parser.parseFromString(await response.text(), 'text/html'));
    if (!page) throw new Error('Page requires a full navigation');
    if (!signal.aborted) pages.set(url.pathname, page);
    return page;
  }

  async function navigate(url) {
    cancelNavigation();
    if (url.pathname === currentPath && url.href === location.href) {
      if (menu) menu.open = false;
      return;
    }

    const controller = new AbortController();
    request = controller;
    try {
      const page = await loadPage(url, controller.signal);
      if (controller.signal.aborted) return;
      await fade(1, .45, 80, 'both');
      if (controller.signal.aborted) return;
      history.pushState(null, '', url);
      showPage(page, url.pathname, true);
    } catch {
      if (!controller.signal.aborted) location.assign(url.href);
    } finally {
      if (request === controller) request = undefined;
    }
  }

  masthead.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
        event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('a[href]');
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || !paths.has(url.pathname) || url.search || url.hash) return;
    event.preventDefault();
    void navigate(url);
  });

  window.addEventListener('popstate', () => {
    cancelNavigation();
    if (location.pathname === currentPath) return;
    const page = pages.get(location.pathname);
    if (page) showPage(page, location.pathname, false);
    else location.reload();
  });
})();
