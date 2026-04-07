// ─── Canvas Background — Ambient Particle Field ────────────────
// Sparse floating particles (0.5–1.5px) drifting slowly.
// opacity: 0.15 — subtle. Makes the void feel alive.
// Canvas 2D (no WebGL dependency).

(function () {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) {return;}
  const ctx = canvas.getContext('2d');
  if (!ctx) {return;}

  let W, H, particles, raf;
  const DENSITY = 0.00007; // particles per square pixel
  const SPEED = 0.12;      // px per frame @ 60fps

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function createParticles() {
    const count = Math.max(30, Math.min(200, Math.floor(W * H * DENSITY)));
    particles = [];
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 0.4 + Math.random() * 1.1,         // radius 0.4–1.5px
        vx: (Math.random() - 0.5) * SPEED,
        vy: (Math.random() - 0.5) * SPEED,
        alpha: 0.12 + Math.random() * 0.20,    // 0.12–0.32
        // Subtle color — mostly warm white, occasional gold tint
        hue: Math.random() < 0.20 ? 43 : 0,
        sat: Math.random() < 0.75 ? 0 : 60,
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    for (const p of particles) {
      // Move
      p.x += p.vx;
      p.y += p.vy;

      // Wrap
      if (p.x < -2) {p.x = W + 2;}
      if (p.x > W + 2) {p.x = -2;}
      if (p.y < -2) {p.y = H + 2;}
      if (p.y > H + 2) {p.y = -2;}

      // Draw
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      if (p.sat > 0) {
        ctx.fillStyle = `hsla(${p.hue}, ${p.sat}%, 70%, ${p.alpha})`;
      } else {
        ctx.fillStyle = `rgba(224, 224, 240, ${p.alpha})`;
      }
      ctx.fill();
    }

    raf = requestAnimationFrame(draw);
  }

  // Respect prefers-reduced-motion
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (mq.matches) {return;}
  mq.addEventListener('change', e => {
    if (e.matches) { cancelAnimationFrame(raf); ctx.clearRect(0, 0, W, H); }
    else { draw(); }
  });

  // Init
  resize();
  createParticles();
  draw();

  // Debounced resize
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resize(); createParticles(); }, 200);
  });
})();
