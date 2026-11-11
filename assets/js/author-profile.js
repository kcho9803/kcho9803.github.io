(() => {
  const desktop = matchMedia('(min-width: 925px)');
  const sizeProperty = '--profile-photo-size';

  for (const profile of document.querySelectorAll('.author-profile')) {
    const photo = profile.querySelector('.author__avatar');
    const content = profile.querySelector('.author__content');
    if (!photo || !content) continue;

    function fitPhoto() {
      if (desktop.matches || !profile.clientWidth) {
        photo.style.removeProperty(sizeProperty);
        return;
      }

      const availableWidth = photo.getBoundingClientRect().width + content.getBoundingClientRect().width;
      // Start with the full text column and grow the square until wrapping settles.
      let size = 0;
      for (let pass = 0; pass < 8; pass++) {
        photo.style.setProperty(sizeProperty, `${size}px`);
        const height = content.getBoundingClientRect().height;
        if (Math.abs(height - size) < .02) return;
        if (height >= availableWidth) break;
        size = height;
      }
      photo.style.removeProperty(sizeProperty);
    }

    let width;
    new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      fitPhoto();
    }).observe(profile);
    desktop.addEventListener('change', fitPhoto);
    document.fonts?.ready.then(fitPhoto);
    fitPhoto();
  }
})();
