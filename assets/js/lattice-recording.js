const layers = ['chain', 'defect', 'pulse'];
const footage = new URL('../video/lattice-loop.mp4', import.meta.url);

export function playLatticeRecording(canvas) {
  const output = canvas.getContext('2d');
  if (!output) return;

  // The three grayscale panels in each video frame hold the opacity of the
  // chain, defects, and messages. Color them to match the active site theme.
  const masks = document.createElement('canvas');
  const reader = masks.getContext('2d', { willReadFrequently: true });
  const picture = document.createElement('canvas');
  const painter = picture.getContext('2d');
  const video = document.createElement('video');
  video.style.cssText = 'position:absolute;inset:0;width:1px;height:1px;opacity:0;pointer-events:none';
  video.muted = true;
  video.playsInline = true;
  video.loop = true;
  video.preload = 'auto';
  canvas.after(video);

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const theme = matchMedia('(prefers-color-scheme: dark)');
  let colors;
  let frame;
  let visible = false;
  let frameRequest;
  let source;

  function draw() {
    if (!frame || video.readyState < 2) return;
    const size = frame.width;
    reader.drawImage(video, 0, 0, masks.width, size);
    const { data: alpha } = reader.getImageData(0, 0, masks.width, size);
    const { data: rgba } = frame;
    const offset = size * 4;
    const [chain, defect, pulse] = colors;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < offset; x += 4) {
        const index = y * offset * layers.length + x;
        const out = y * offset + x;
        // Drop near-black compression artifacts before compositing.
        const p = Math.max(0, alpha[index + 2 * offset] - 5) / 250;
        const d = Math.max(0, alpha[index + offset] - 5) / 250 * (1 - p);
        const c = Math.max(0, alpha[index] - 5) / 250 * (1 - p - d);
        const opacity = p + d + c;
        rgba[out + 3] = 255 * opacity;
        if (!opacity) continue;
        for (let channel = 0; channel < 3; channel++) {
          rgba[out + channel] = (c * chain[channel] + d * defect[channel] + p * pulse[channel]) / opacity;
        }
      }
    }

    painter.putImageData(frame, 0, 0);
    output.clearRect(0, 0, canvas.width, canvas.height);
    output.drawImage(picture, 0, 0, canvas.width, canvas.height);
  }

  function readColors() {
    const style = getComputedStyle(canvas);
    colors = layers.map(layer => {
      const hex = style.getPropertyValue(`--hero-${layer}`).trim().slice(1);
      return [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16));
    });
    draw();
  }

  function canPlay() {
    return visible && canvas.isConnected && !document.hidden && !motion.matches;
  }

  function drawNextFrame() {
    frameRequest = undefined;
    draw();
    if (!video.paused && canPlay()) queueFrame();
  }

  function queueFrame() {
    if (frameRequest !== undefined) return;
    frameRequest = video.requestVideoFrameCallback
      ? video.requestVideoFrameCallback(drawNextFrame)
      : requestAnimationFrame(drawNextFrame);
  }

  function syncPlayback() {
    if (visible && !source) {
      video.src = footage;
      source = true;
    }
    if (canPlay()) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }

  readColors();
  video.addEventListener('loadeddata', () => {
    const size = Math.min(video.videoHeight, 256);
    masks.width = size * layers.length;
    masks.height = picture.width = picture.height = size;
    frame = painter.createImageData(size, size);
    draw();
  });
  video.addEventListener('playing', queueFrame);
  new ResizeObserver(([entry]) => {
    const size = Math.round(entry.contentRect.width * Math.min(devicePixelRatio, 2));
    if (!size) return;
    canvas.width = canvas.height = size;
    draw();
  }).observe(canvas);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    syncPlayback();
  }).observe(canvas);
  new MutationObserver(readColors).observe(document.documentElement, { attributeFilter: ['data-theme'] });
  theme.addEventListener('change', readColors);
  motion.addEventListener('change', syncPlayback);
  document.addEventListener('visibilitychange', syncPlayback);
  document.addEventListener('site:page-change', syncPlayback);
}
