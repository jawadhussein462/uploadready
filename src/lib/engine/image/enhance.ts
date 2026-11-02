/**
 * Pixel operations on RGBA buffers (pure, testable).
 */
import { borderStats, type RGBA } from "./analysis";

export function toGrayscale(img: RGBA): void {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = y;
  }
}

/**
 * Signature clean-up: pushes the paper to pure white while keeping the ink's hue.
 * Each pixel is blended toward white by how close its luma is to the paper luma.
 */
export function whitenPaper(img: RGBA): void {
  const d = img.data;
  const stats = borderStats(img, 0.05);
  const paper = 0.2126 * stats.median[0] + 0.7152 * stats.median[1] + 0.0722 * stats.median[2];
  const lumas: number[] = [];
  const step = Math.max(1, Math.floor(d.length / 4 / 20000));
  for (let p = 0; p < d.length / 4; p += step) {
    const i = p * 4;
    lumas.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
  }
  lumas.sort((a, b) => a - b);
  const ink = lumas[Math.floor(lumas.length * 0.01)] ?? 0;
  const range = Math.max(30, paper - ink);
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    let k = (paper - l) / range;
    k = k <= 0.12 ? 0 : Math.min(1, (k - 0.12) / 0.7);
    k = Math.pow(k, 0.8);
    d[i] = 255 - (255 - d[i]) * k;
    d[i + 1] = 255 - (255 - d[i + 1]) * k;
    d[i + 2] = 255 - (255 - d[i + 2]) * k;
  }
}

/**
 * Page clean-up for phone photos of paper: estimates the paper colour across
 * the page (bright envelope per 32-px block, smoothed), divides it out to remove
 * shadows and colour casts, then applies a gentle contrast curve.
 */
export function flattenPage(img: RGBA): void {
  const { data: d, width: w, height: h } = img;
  const block = Math.max(8, Math.round(Math.max(w, h) / 48));
  const bw = Math.ceil(w / block);
  const bh = Math.ceil(h / block);
  const bg = new Float32Array(bw * bh * 3);
  const samples: number[][] = [[], [], []];
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      samples[0].length = samples[1].length = samples[2].length = 0;
      const y0 = by * block;
      const x0 = bx * block;
      const stepIn = Math.max(1, Math.floor(block / 8));
      for (let y = y0; y < Math.min(h, y0 + block); y += stepIn) {
        for (let x = x0; x < Math.min(w, x0 + block); x += stepIn) {
          const i = (y * w + x) * 4;
          samples[0].push(d[i]);
          samples[1].push(d[i + 1]);
          samples[2].push(d[i + 2]);
        }
      }
      for (let c = 0; c < 3; c++) {
        const s = samples[c].sort((a, b) => a - b);
        bg[(by * bw + bx) * 3 + c] = s[Math.floor(s.length * 0.9)] ?? 255;
      }
    }
  }
  // Smooth the background map (3 passes of a 3×3 box filter).
  const tmp = new Float32Array(bg.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          let n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const yy = by + dy;
              const xx = bx + dx;
              if (yy < 0 || yy >= bh || xx < 0 || xx >= bw) continue;
              sum += bg[(yy * bw + xx) * 3 + c];
              n++;
            }
          }
          tmp[(by * bw + bx) * 3 + c] = sum / n;
        }
      }
    }
    bg.set(tmp);
  }
  // Divide out the background with bilinear interpolation of the block map.
  for (let y = 0; y < h; y++) {
    const fy = Math.min(bh - 1, Math.max(0, y / block - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(bh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bw - 1, Math.max(0, x / block - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(bw - 1, x0 + 1);
      const tx = fx - x0;
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const a = bg[(y0 * bw + x0) * 3 + c];
        const b = bg[(y0 * bw + x1) * 3 + c];
        const cc = bg[(y1 * bw + x0) * 3 + c];
        const dd = bg[(y1 * bw + x1) * 3 + c];
        const paper = (a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + dd * tx) * ty;
        let v = (d[i + c] / Math.max(24, paper)) * 255;
        // Contrast: keep whites white, deepen mid-tones slightly.
        v = 255 * Math.pow(Math.min(1, v / 250), 1.25);
        d[i + c] = v;
      }
    }
  }
}
