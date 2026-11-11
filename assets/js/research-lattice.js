(() => {
  const canvas = document.querySelector('.research-lattice');
  const ctx = canvas?.getContext('2d');
  if (!ctx) return;

  // Edges are horizontal first, then vertical. Site coordinates increase north.
  const east = [1, 0];
  const north = [0, -1];
  const directions = [east, [-1, 0], north, [0, 1]];
  const bitCounts = [0, 1, 1, 2, 1, 2, 2, 3];
  const stillChain = [180, 181, 422, 166, 167, 408, 152];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  const hold = 850;
  const playback = 6400;
  const rest = 850;
  const pulseLength = 360;
  const moveLength = 260;
  const minMoveLength = 80;
  const targetCellHeight = 10;
  const minSide = 8;
  const maxSide = 32;
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
  const liveSource = loopback && canvas.dataset.liveLattice;

  let side = 16;
  let requestedSide = side;
  let sites = side * side;
  let chain;
  let defects;
  let cycle;
  let next;
  let correction;
  let firstHop;
  let messageFrame;
  let time;
  let previous;
  let animation;
  let visible = false;
  let size;
  let colors;

  let loading = false;
  let retryTimer;
  let retryDelay = 1000;
  let unavailable = false;

  function toggle(set, item) {
    if (set.has(item)) set.delete(item);
    else set.add(item);
  }

  function edgeEnd(edge) {
    const start = edge % sites;
    return edge < sites
      ? start - start % side + (start + 1) % side
      : (start + side) % sites;
  }

  function flip(edge) {
    toggle(chain, edge);
    toggle(defects, edge % sites);
    toggle(defects, edgeEnd(edge));
  }

  function setChain(edges) {
    chain = new Set();
    defects = new Set();
    edges.forEach(flip);
  }

  function siteX(site) {
    return site % side + .5;
  }

  function siteY(site) {
    return side - Math.floor(site / side) - .5;
  }

  function smooth(value) {
    const t = Math.max(0, Math.min(value, 1));
    return t * t * (3 - 2 * t);
  }

  function segment(site, [dx, dy], start = 0, end = 1) {
    const x = siteX(site);
    const y = siteY(site);
    const shiftX = x + dx < 0 ? side : x + dx > side ? -side : 0;
    const shiftY = y + dy < 0 ? side : y + dy > side ? -side : 0;
    ctx.moveTo(x + start * dx, y + start * dy);
    ctx.lineTo(x + end * dx, y + end * dy);
    if (shiftX || shiftY) {
      ctx.moveTo(x + shiftX + start * dx, y + shiftY + start * dy);
      ctx.lineTo(x + shiftX + end * dx, y + shiftY + end * dy);
    }
  }

  function drawSquare(site, [dx, dy] = east, progress = 0) {
    const half = .23;
    const x = siteX(site) + dx * progress;
    const y = siteY(site) + dy * progress;
    ctx.fillRect(x - half, y - half, 2 * half, 2 * half);
    // Split a moving defect across the periodic seam as it crosses.
    const shiftX = x < half ? side : x > side - half ? -side : 0;
    const shiftY = y < half ? side : y > side - half ? -side : 0;
    if (shiftX || shiftY) ctx.fillRect(x + shiftX - half, y + shiftY - half, 2 * half, 2 * half);
  }

  function drawMessages(fade) {
    const frames = cycle.messageFrames;
    const phase = Math.min(time / playback, 1);
    while (messageFrame + 1 < frames.length && frames[messageFrame + 1][0] <= phase) messageFrame++;
    const [stamp, bits] = frames[messageFrame];
    const [nextStamp, nextBits] = frames[messageFrame + 1] ?? frames[messageFrame];
    const mix = nextStamp > stamp ? smooth((phase - stamp) / (nextStamp - stamp)) : 0;
    ctx.fillStyle = colors.pulse;
    for (let site = 0; site < sites; site++) {
      const current = bitCounts[bits.charCodeAt(site) - 48];
      const upcoming = bitCounts[nextBits.charCodeAt(site) - 48];
      const count = current + (upcoming - current) * mix;
      if (count <= .01) continue;
      ctx.globalAlpha = fade * Math.min(1, count) * (.52 + .08 * count);
      ctx.beginPath();
      ctx.arc(siteX(site), siteY(site), .15 + .035 * count, 0, 2 * Math.PI);
      ctx.fill();
    }

    const hops = cycle.hops;
    while (firstHop < hops.length && hops[firstHop][0] * playback < time) firstHop++;
    ctx.strokeStyle = colors.pulse;
    ctx.lineCap = 'round';
    ctx.lineWidth = .23;
    for (let i = firstHop; i < hops.length; i++) {
      const [stamp, site, direction] = hops[i];
      const progress = 1 + (time - stamp * playback) / pulseLength;
      if (progress < 0) break;
      const trail = Math.max(0, progress - .48);
      ctx.globalAlpha = fade * smooth(progress / .12) * smooth((1 - progress) / .16);
      ctx.beginPath();
      segment(site, directions[direction], trail, progress);
      ctx.stroke();
      ctx.lineWidth = .35;
      ctx.beginPath();
      segment(site, directions[direction], Math.max(trail, progress - .12), progress);
      ctx.stroke();
      ctx.lineWidth = .23;
    }
    ctx.lineCap = 'butt';
  }

  function draw() {
    if (!size || !colors) return;
    const fade = cycle ? smooth((time + hold) / 450) * smooth((cycle.endTime - time) / 470) : 1;
    const move = cycle?.moves[correction];
    const moving = move && time >= move.start;
    const edge = moving ? move.edge : -1;
    const start = moving ? edge % sites : -1;
    const end = moving ? edgeEnd(edge) : -1;
    const progress = moving ? smooth((time - move.start) / (move.end - move.start)) : 0;
    const hasStart = defects.has(start);
    const hasEnd = defects.has(end);
    const pair = hasStart && hasEnd;
    const axis = edge < sites ? east : north;

    ctx.clearRect(0, 0, side, side);
    ctx.globalAlpha = fade;
    ctx.lineWidth = .18;
    ctx.strokeStyle = colors.chain;
    ctx.beginPath();
    for (const drawnEdge of chain) {
      if (drawnEdge !== edge) segment(drawnEdge % sites, drawnEdge < sites ? east : north);
    }
    if (moving) {
      const grows = !chain.has(edge);
      const length = grows ? progress : 1 - progress;
      const from = pair ? (1 - length) / 2 : hasEnd === grows ? 1 - length : 0;
      segment(start, axis, from, from + length);
    }
    ctx.stroke();

    if (cycle && time >= 0) drawMessages(fade);

    ctx.globalAlpha = fade;
    ctx.fillStyle = colors.defect;
    for (const site of defects) {
      if (site !== start && site !== end) drawSquare(site);
    }
    if (moving) {
      if (pair) ctx.globalAlpha *= 1 - smooth((progress - .5) / .5);
      if (hasStart) drawSquare(start, axis, pair ? progress / 2 : progress);
      if (hasEnd) drawSquare(start, axis, pair ? 1 - progress / 2 : 1 - progress);
    }
    ctx.globalAlpha = 1;
  }

  function canPlay() {
    return visible && !document.hidden && !reducedMotion.matches;
  }

  function randomIndex(count) {
    return Math.floor(Math.random() * count);
  }

  // Script an illustrative path and decorative pulses for the static site.
  function illustrate(size) {
    const cells = size * size;
    const length = Math.min(12, Math.round(size * .48));
    const horizontal = 2 + randomIndex(length - 2);
    const vertical = length - horizontal;
    const bend = 1 + randomIndex(horizontal - 1);
    const dx = randomIndex(2) ? 1 : -1;
    const dy = randomIndex(2) ? 1 : -1;
    let x = 1 + randomIndex(size - horizontal - 2) + (dx < 0 ? horizontal : 0);
    let y = 1 + randomIndex(size - vertical - 2) + (dy < 0 ? vertical : 0);
    const chain = [];
    for (let i = 0; i < length; i++) {
      if (i >= bend && i < bend + vertical) {
        chain.push(cells + Math.min(y, y + dy) * size + x);
        y += dy;
      } else {
        chain.push(y * size + Math.min(x, x + dx));
        x += dx;
      }
    }

    // Retract the path from its ends so the two markers meet on the last edge.
    let left = 0;
    let right = chain.length - 1;
    const changes = chain.map((_, i) => [
      .27 + .7 * (i + 1) / length,
      chain[i % 2 === 0 ? left++ : right--]
    ]);

    const hops = [];
    const dots = [];
    const trains = Math.min(16, size + 3);
    for (let train = 0; train < trains; train++) {
      const direction = randomIndex(directions.length);
      const [stepX, screenY] = directions[direction];
      const stepY = -screenY;
      const steps = 2 + randomIndex(4);
      const along = randomIndex(size - steps);
      const across = randomIndex(size);
      let site = stepX
        ? across * size + along + (stepX < 0 ? steps : 0)
        : (along + (stepY < 0 ? steps : 0)) * size + across;
      let stamp = .03 + .68 * (train + Math.random()) / trains;
      for (let step = 0; step < steps; step++) {
        dots.push([site, stamp, stamp + .03]);
        stamp += .05;
        hops.push([stamp, site, direction]);
        site += stepX + stepY * size;
      }
      dots.push([site, stamp, stamp + .04]);
    }
    hops.sort((a, b) => a[0] - b[0]);

    const messageFrames = Array.from({ length: 65 }, (_, i) => {
      const phase = i / 64;
      const bits = Array(cells).fill('0');
      for (const [site, from, to] of dots) {
        if (phase >= from && phase < to) bits[site] = '1';
      }
      return [phase, bits.join('')];
    });
    return { size, chain, changes, hops, messageFrames };
  }

  async function loadCycle() {
    if (loading || next || retryTimer !== undefined || unavailable) return;
    const cycleSide = requestedSide;
    const url = new URL(liveSource, location.origin);
    url.searchParams.set('size', cycleSide);
    loading = true;
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        mode: 'same-origin',
        signal: AbortSignal.timeout(15000)
      });
      if (response.ok) {
        const data = await response.json();
        if (data.size === cycleSide && cycleSide === requestedSide &&
            Array.isArray(data.messageFrames) && data.messageFrames.length) {
          next = data;
          retryDelay = 1000;
        }
      } else if (response.status === 403 || response.status === 404) {
        unavailable = true;
      }
    } catch {
      // Transient network failures are retried with the same bounded delay.
    } finally {
      loading = false;
    }
    if (cycleSide === requestedSide && !next && !unavailable && canPlay()) {
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        schedule();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 8000);
    }
    schedule();
  }

  function startCycle() {
    const { changes, ...data } = next;
    let lastMoveEnd = 0;
    const moves = changes.map(([stamp, edge], index) => {
      const start = Math.max(stamp * playback, lastMoveEnd);
      // Shorten clustered moves, keeping their order on the continuous clock.
      const nextStamp = changes[index + 1]?.[0];
      const gap = nextStamp === undefined ? moveLength : nextStamp * playback - start;
      const end = start + Math.max(minMoveLength, Math.min(moveLength, gap));
      lastMoveEnd = end;
      return { edge, start, end };
    });
    cycle = { ...data, moves, endTime: Math.max(playback, lastMoveEnd) + rest };
    next = undefined;
    correction = firstHop = messageFrame = 0;
    previous = undefined;
    time = -hold;
    if (side !== cycle.size) {
      side = cycle.size;
      sites = side * side;
      canvas.style.setProperty('--lattice-cell', `${100 / side}%`);
      canvas.style.setProperty('--lattice-offset', `${50 / (side - 1)}%`);
      if (size) ctx.setTransform(size / side, 0, 0, size / side, 0, 0);
    }
    setChain(cycle.chain);
  }

  function advance(delta) {
    time += delta;
    while (correction < cycle.moves.length && time >= cycle.moves[correction].end) {
      flip(cycle.moves[correction].edge);
      correction++;
    }
  }

  function tick(now) {
    animation = undefined;
    if (!cycle) startCycle();
    if (previous !== undefined) advance(Math.min(now - previous, 70));
    previous = now;
    if (time >= cycle.endTime) {
      cycle = undefined;
      setChain([]);
    }
    draw();
    schedule();
  }

  function schedule() {
    if (!canPlay()) {
      cancelAnimationFrame(animation);
      clearTimeout(retryTimer);
      animation = previous = retryTimer = undefined;
      draw();
      return;
    }
    if (!next) {
      if (liveSource && !unavailable) void loadCycle();
      else next = illustrate(requestedSide);
    }
    if (animation === undefined && (next || cycle)) animation = requestAnimationFrame(tick);
  }

  function refreshColors() {
    const style = getComputedStyle(canvas);
    colors = Object.fromEntries(['chain', 'defect', 'pulse'].map(name =>
      [name, style.getPropertyValue('--hero-' + name).trim()]));
    draw();
  }

  setChain(stillChain);
  refreshColors();
  new ResizeObserver(([entry]) => {
    size = Math.max(1, Math.round(entry.contentRect.width * Math.min(devicePixelRatio, 2)));
    canvas.width = canvas.height = size;
    ctx.setTransform(size / side, 0, 0, size / side, 0, 0);
    const fittedSide = Math.round(entry.contentRect.height / targetCellHeight);
    requestedSide = Math.max(minSide, Math.min(maxSide, fittedSide));
    if (next && next.size !== requestedSide) next = undefined;
    if (canPlay()) schedule();
    draw();
  }).observe(canvas);
  new MutationObserver(refreshColors).observe(document.documentElement, {
    attributeFilter: ['data-theme']
  });
  systemTheme.addEventListener('change', refreshColors);

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    schedule();
  }).observe(canvas);
  reducedMotion.addEventListener('change', schedule);
  document.addEventListener('visibilitychange', schedule);
})();
