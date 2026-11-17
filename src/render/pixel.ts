export type RGBA = readonly [number, number, number, number];

/** Software pixel buffer. Used at init to bake crisp art (no canvas antialias). */
export class Pix {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  px(x: number, y: number, c: RGBA): void {
    const xi = x | 0;
    const yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    const i = (yi * this.w + xi) * 4;
    const a = c[3];
    if (a >= 255 || this.data[i + 3] === 0) {
      this.data[i] = c[0];
      this.data[i + 1] = c[1];
      this.data[i + 2] = c[2];
      this.data[i + 3] = a;
      return;
    }
    const sa = a / 255;
    const ia = 1 - sa;
    this.data[i] = c[0] * sa + this.data[i] * ia;
    this.data[i + 1] = c[1] * sa + this.data[i + 1] * ia;
    this.data[i + 2] = c[2] * sa + this.data[i + 2] * ia;
    this.data[i + 3] = Math.min(255, a + this.data[i + 3] * ia);
  }

  hline(y: number, x0: number, x1: number, c: RGBA): void {
    const yi = y | 0;
    if (yi < 0 || yi >= this.h) return;
    let a = Math.round(x0);
    let b = Math.round(x1);
    if (a > b) {
      const t = a;
      a = b;
      b = t;
    }
    if (b < 0 || a >= this.w) return;
    if (a < 0) a = 0;
    if (b >= this.w) b = this.w - 1;
    for (let x = a; x <= b; x++) this.px(x, yi, c);
  }

  rect(x: number, y: number, w: number, h: number, c: RGBA): void {
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    const x1 = Math.round(x + w);
    const y1 = Math.round(y + h);
    for (let yy = y0; yy < y1; yy++) this.hline(yy, x0, x1 - 1, c);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: RGBA): void {
    let xa = Math.round(x0);
    let ya = Math.round(y0);
    const xb = Math.round(x1);
    const yb = Math.round(y1);
    const dx = Math.abs(xb - xa);
    const dy = Math.abs(yb - ya);
    const sx = xa < xb ? 1 : -1;
    const sy = ya < yb ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      this.px(xa, ya, c);
      if (xa === xb && ya === yb) break;
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        xa += sx;
      }
      if (e2 < dx) {
        err += dx;
        ya += sy;
      }
    }
  }

  /** Trapezoid with horizontal top and bottom. */
  trap(
    yTop: number,
    yBot: number,
    topL: number,
    topR: number,
    botL: number,
    botR: number,
    c: RGBA,
  ): void {
    const y0 = Math.round(Math.min(yTop, yBot));
    const y1 = Math.round(Math.max(yTop, yBot));
    const span = yBot - yTop || 1;
    for (let y = y0; y <= y1; y++) {
      const t = (y - yTop) / span;
      const l = topL + (botL - topL) * t;
      const r = topR + (botR - topR) * t;
      this.hline(y, l, r, c);
    }
  }

  dashed(x0: number, y0: number, x1: number, y1: number, c: RGBA, on = 3, off = 2): void {
    const xa = Math.round(x0);
    const ya = Math.round(y0);
    const xb = Math.round(x1);
    const yb = Math.round(y1);
    const dx = Math.abs(xb - xa);
    const dy = Math.abs(yb - ya);
    const sx = xa < xb ? 1 : -1;
    const sy = ya < yb ? 1 : -1;
    let err = dx - dy;
    let x = xa;
    let y = ya;
    let i = 0;
    const period = on + off;
    for (;;) {
      if (i % period < on) this.px(x, y, c);
      if (x === xb && y === yb) break;
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
      i++;
    }
  }

  blit(src: Pix, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number): void {
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const si = ((sy + y) * src.w + (sx + x)) * 4;
        if (src.data[si + 3] === 0) continue;
        this.px(dx + x, dy + y, [
          src.data[si],
          src.data[si + 1],
          src.data[si + 2],
          src.data[si + 3],
        ]);
      }
    }
  }

  toCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = this.w;
    canvas.height = this.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    const image = ctx.createImageData(this.w, this.h);
    image.data.set(this.data);
    ctx.putImageData(image, 0, 0);
    return canvas;
  }
}
