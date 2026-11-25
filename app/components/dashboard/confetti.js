// Confetti for the feedback card's dot. It is drawn on a canvas that covers the
// card, so the burst stays inside it. Each piece is thrown outward, slows
// through the air, then drifts down while it spins and flips like paper.

const COLORS = ['#00bf63', '#34d399', '#a7f3d0', '#fbbf24', '#fde68a', '#f472b6', '#a78bfa', '#38bdf8', '#fb7185'];
const FRAME_MS = 1000 / 60;

function between(min, max) {
  return min + Math.random() * (max - min);
}

function makePiece(x, y, index, power, gravity, colors) {
  // Most pieces fan upward; the rest go every direction so the burst is round.
  const upward = index % 4 !== 0;
  const pick = Math.random();
  const shape = pick < 0.55 ? 'paper' : pick < 0.8 ? 'dot' : 'streamer';
  return {
    x, y,
    angle: upward ? -Math.PI / 2 + between(-1.15, 1.15) : between(0, Math.PI * 2),
    speed: (upward ? between(9, 27) : between(5, 15)) * power, // the throw, which air drag wears down
    fall: between(2.1, 3.6) * gravity,
    drift: between(-0.5, 0.5),
    sway: between(0, Math.PI * 2),
    swaySpeed: between(0.06, 0.13),
    rotation: between(0, Math.PI * 2),
    spin: between(-0.22, 0.22),
    flip: between(0, Math.PI * 2),
    flipSpeed: between(0.1, 0.28),
    width: shape === 'streamer' ? 3 : shape === 'dot' ? between(6, 9) : between(7, 12),
    height: shape === 'streamer' ? between(12, 18) : shape === 'dot' ? 0 : between(4, 7),
    shape,
    color: colors[Math.floor(Math.random() * colors.length)],
    age: 0,
    life: between(95, 155), // in 60fps frames
  };
}

/**
 * Bursts confetti from a point measured from the canvas's top-left corner.
 * Returns a function that stops it early.
 */
export function burstConfetti(canvas, x, y, { pieces: count = 80, power = 1, gravity = 1, colors = [] } = {}) {
  const context = canvas.getContext('2d');
  if (!context) return () => {};
  const palette = [...COLORS, ...colors];
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth, height = canvas.clientHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);

  const pieces = Array.from({ length: count }, (_, index) => makePiece(x, y, index, power, gravity, palette));
  let flash = 0; // the pop ring's age, in frames
  let last = performance.now();
  let request = 0;

  function finish() {
    window.cancelAnimationFrame(request);
    context.clearRect(0, 0, width, height);
  }

  function frame(now) {
    // Step in 60fps frames, capped so a stalled tab does not teleport pieces.
    const step = Math.min(Math.max(now - last, 0), 50) / FRAME_MS;
    last = now;
    context.clearRect(0, 0, width, height);

    // A quick ring where the dot popped.
    flash += step;
    if (flash < 16) {
      const progress = flash / 16;
      context.globalAlpha = (1 - progress) * 0.7;
      context.strokeStyle = COLORS[0];
      context.lineWidth = 4 * (1 - progress) * power + 1;
      context.beginPath();
      context.arc(x, y, (14 + progress * 46) * power, 0, Math.PI * 2);
      context.stroke();
    }

    let alive = 0;
    for (const piece of pieces) {
      piece.age += step;
      if (piece.age >= piece.life) continue;
      alive += 1;

      piece.x += (Math.cos(piece.angle) * piece.speed + piece.drift + Math.cos(piece.sway) * 0.9) * step;
      piece.y += (Math.sin(piece.angle) * piece.speed + piece.fall) * step;
      piece.speed *= Math.pow(0.91, step);
      piece.sway += piece.swaySpeed * step;
      piece.rotation += piece.spin * step;
      piece.flip += piece.flipSpeed * step;

      // Pieces flip like paper: the face narrows to an edge and the back is darker.
      const face = Math.cos(piece.flip);
      const remaining = 1 - piece.age / piece.life;
      context.globalAlpha = Math.min(1, remaining / 0.28);
      context.save();
      context.translate(piece.x, piece.y);
      context.rotate(piece.rotation);
      context.scale(1, Math.max(0.12, Math.abs(face)));
      for (const fill of face < 0 ? [piece.color, 'rgba(0, 0, 0, 0.2)'] : [piece.color]) {
        context.fillStyle = fill;
        context.beginPath();
        if (piece.shape === 'dot') context.arc(0, 0, piece.width / 2, 0, Math.PI * 2);
        else context.rect(-piece.width / 2, -piece.height / 2, piece.width, piece.height);
        context.fill();
      }
      context.restore();
    }
    context.globalAlpha = 1;

    if (alive > 0) request = window.requestAnimationFrame(frame);
    else finish();
  }

  request = window.requestAnimationFrame(frame);
  return finish;
}
