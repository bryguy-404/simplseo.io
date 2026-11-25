"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "@/app/contexts/ThemeContext";
import styles from "./HomepageMotion.module.css";

// A field of small marks across the hero. Rings ripple outward from the
// cursor, like a signal being picked up, and the marks swell and turn as each
// ring passes. With no cursor (touch screens, idle), the centre wanders.

const TAU = Math.PI * 2;
const LEVELS = 7; // how many brightness steps the marks are grouped into

const PALETTE = {
  dark: ["45, 212, 191", "0, 191, 99", "126, 226, 174", "205, 255, 228"],
  light: ["13, 148, 136", "22, 160, 90", "15, 122, 72", "0, 168, 87"],
};

const rand = (i) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// `bleed` is how far the canvas extends below its parent (see the CSS class used).
export default function HeroField({ className, bleed = 90 }) {
  const BLEED = bleed;
  const canvasRef = useRef(null);
  const { isDarkMode } = useTheme();
  const themeRef = useRef(isDarkMode);
  const redrawRef = useRef(null);

  useEffect(() => {
    themeRef.current = isDarkMode;
    redrawRef.current?.();
  }, [isDarkMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const hero = canvas?.parentElement;
    if (!canvas || !hero) return;
    const ctx = canvas.getContext("2d");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let W = 0, H = 0, dpr = 1, marks = [];
    let raf = 0, visible = true, last = 0, time = 0, intro = 0;
    const centre = { x: 0, y: 0, ready: false };
    const pointer = { x: 0, y: 0, weight: 0, lastMove: -1e9 };
    // One list of line segments per colour and brightness level, reused each frame.
    const batches = Array.from({ length: PALETTE.dark.length * LEVELS }, () => []);

    const measure = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = hero.clientWidth;
      H = hero.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round((H + BLEED) * dpr);

      // Marks sit on a loose, jittered grid so the field never looks tiled.
      const gap = W < 640 ? 26 : 32;
      marks = [];
      let id = 0;
      for (let row = 0, y = gap / 2; y < H + BLEED; row++, y += gap * 0.9) {
        for (let x = (row % 2 ? gap : gap / 2); x < W; x += gap) {
          id++;
          marks.push({
            hx: x + (rand(id) - 0.5) * gap * 0.9,
            hy: y + (rand(id + 7000) - 0.5) * gap * 0.9,
            ox: 0, oy: 0, energy: 0,
            seed: rand(id + 14000),
          });
        }
      }
      if (!centre.ready) { centre.x = W * 0.5; centre.y = H * 0.5; centre.ready = true; }
    };

    const draw = (t, dt) => {
      const tones = themeRef.current ? PALETTE.dark : PALETTE.light;
      const toneCount = tones.length;
      for (const batch of batches) batch.length = 0;

      const follow = 1 - Math.exp(-dt * 7);
      const reach = Math.max(360, Math.min(W, H) * 0.62);

      for (const mark of marks) {
        const dx = mark.hx - centre.x, dy = mark.hy - centre.y;
        const distance = Math.hypot(dx, dy) || 1;
        const ux = dx / distance, uy = dy / distance;

        // Rings travel outward from the centre and fade with distance.
        const ring = 0.5 + 0.5 * Math.cos(((distance - t * 62) / 185) * TAU);
        const falloff = 1 / (1 + (distance / reach) ** 2.4);
        const hollow = 1 - Math.exp(-((distance / 70) ** 2));
        const target = ring * ring * ring * falloff * hollow * intro;
        mark.energy += (target - mark.energy) * (dt ? follow : 1);
        const energy = mark.energy;

        // Each mark is nudged outward and slightly around as a ring passes.
        const tx = (ux * 13 - uy * 6) * energy, ty = (uy * 13 + ux * 6) * energy;
        mark.ox += (tx - mark.ox) * (dt ? follow : 1);
        mark.oy += (ty - mark.oy) * (dt ? follow : 1);

        const x = mark.hx + mark.ox, y = mark.hy + mark.oy;
        const half = 0.35 + energy * 4.6 + 0.25 * Math.sin(t * 0.9 + mark.seed * TAU);
        // Marks lie along the rings, tilted a little, so the field reads as a swirl.
        const angle = Math.atan2(dy, dx) + Math.PI / 2 - 0.45;
        const ax = Math.cos(angle) * half, ay = Math.sin(angle) * half;

        const tone = Math.floor((((angle / TAU) % 1 + 1.5 + mark.seed * 0.3) % 1) * toneCount);
        const level = Math.max(0, Math.min(LEVELS - 1, Math.floor(energy * LEVELS + mark.seed * 0.9)));
        batches[tone * LEVELS + level].push(x - ax, y - ay, x + ax, y + ay);
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H + BLEED);
      ctx.lineCap = "round";
      for (let tone = 0; tone < toneCount; tone++) {
        for (let level = 0; level < LEVELS; level++) {
          const batch = batches[tone * LEVELS + level];
          if (!batch.length) continue;
          const strength = level / (LEVELS - 1);
          const base = themeRef.current ? 0.26 : 0.16;
          ctx.strokeStyle = `rgba(${tones[tone]}, ${Math.min(1, base + 0.85 * strength) * Math.min(1, intro * 1.5)})`;
          ctx.lineWidth = 1.25 + strength * 1.7;
          ctx.beginPath();
          for (let i = 0; i < batch.length; i += 4) {
            ctx.moveTo(batch[i], batch[i + 1]);
            ctx.lineTo(batch[i + 2], batch[i + 3]);
          }
          ctx.stroke();
        }
      }
    };

    const frame = (now) => {
      raf = 0;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000 || 0));
      last = now;
      time += dt;
      intro = Math.min(1, intro + dt / 1.6);

      // Follow the cursor while it is moving; otherwise wander on a slow loop.
      const idle = (now - pointer.lastMove) / 1000;
      const wanted = idle < 3.5 ? 1 : 0;
      pointer.weight += (wanted - pointer.weight) * (1 - Math.exp(-dt * 1.6));
      const wanderX = W * (0.5 + 0.3 * Math.sin(time * 0.21));
      const wanderY = H * (0.5 + 0.2 * Math.sin(time * 0.29 + 1.1));
      const targetX = wanderX + (pointer.x - wanderX) * pointer.weight;
      const targetY = wanderY + (pointer.y - wanderY) * pointer.weight;
      const ease = 1 - Math.exp(-dt * 4.5);
      centre.x += (targetX - centre.x) * ease;
      centre.y += (targetY - centre.y) * ease;

      draw(time, dt);
      if (canRun()) raf = requestAnimationFrame(frame);
    };

    const canRun = () => visible && !document.hidden && !reduceMotion.matches;
    const schedule = () => {
      if (raf || !canRun()) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    const drawStill = () => {
      intro = 1;
      centre.x = W * 0.5;
      centre.y = H * 0.5;
      draw(time || 3, 0);
    };

    const refresh = () => {
      measure();
      if (reduceMotion.matches) drawStill();
      else schedule();
    };

    redrawRef.current = () => { if (reduceMotion.matches) drawStill(); };

    const onPointer = (event) => {
      if (event.pointerType === "touch") return;
      const box = hero.getBoundingClientRect();
      pointer.x = event.clientX - box.left;
      pointer.y = event.clientY - box.top;
      pointer.lastMove = performance.now();
    };
    const onVisibility = () => schedule();
    const onMotionChange = () => refresh();

    const resizeObserver = new ResizeObserver(refresh);
    resizeObserver.observe(hero);
    const viewObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      schedule();
    });
    viewObserver.observe(hero);
    window.addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    reduceMotion.addEventListener("change", onMotionChange);
    refresh();

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      viewObserver.disconnect();
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      reduceMotion.removeEventListener("change", onMotionChange);
      redrawRef.current = null;
    };
  }, [BLEED]);

  return <canvas ref={canvasRef} className={className || styles.field} aria-hidden="true" />;
}
