// The Poster for a Place That Isn't There — AERIDOR
// A vintage-style travel poster for a floating island nation, drawn entirely
// in code. Node 22 stdlib only: own PNG encoder (node:zlib), own 5x7 bitmap
// font. No network, no packages, fully deterministic.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------- palette
type RGB = [number, number, number];
const NAVY: RGB = [20, 38, 77];
const GOLD: RGB = [232, 182, 76];
const CREAM: RGB = [255, 233, 176];
const WHITE: RGB = [255, 255, 255];
const SKY_STOPS: Array<[number, RGB]> = [
  [0.0, [28, 35, 80]],
  [0.25, [74, 63, 143]],
  [0.5, [168, 90, 140]],
  [0.68, [224, 122, 90]],
  [0.82, [242, 166, 94]],
  [1.0, [255, 217, 160]],
];

// ---------------------------------------------------------------- canvas
const buf = Buffer.alloc(W * H * 4);

function setPx(x: number, y: number, c: RGB): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || xi >= W || yi < 0 || yi >= H) return;
  const i = (yi * W + xi) * 4;
  buf[i] = c[0];
  buf[i + 1] = c[1];
  buf[i + 2] = c[2];
  buf[i + 3] = 255;
}

function blendPx(x: number, y: number, c: RGB, a: number): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || xi >= W || yi < 0 || yi >= H) return;
  const i = (yi * W + xi) * 4;
  buf[i] = Math.round(buf[i] * (1 - a) + c[0] * a);
  buf[i + 1] = Math.round(buf[i + 1] * (1 - a) + c[1] * a);
  buf[i + 2] = Math.round(buf[i + 2] * (1 - a) + c[2] * a);
  buf[i + 3] = 255;
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(W, Math.round(x + w));
  const y1 = Math.min(H, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * W + xx) * 4;
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
      buf[i + 3] = 255;
    }
  }
}

function hline(x0: number, x1: number, y: number, c: RGB): void {
  fillRect(Math.min(x0, x1), y, Math.abs(x1 - x0) + 1, 1, c);
}

function fillCircle(cx: number, cy: number, r: number, c: RGB): void {
  for (let dy = -r; dy <= r; dy++) {
    const dx = Math.floor(Math.sqrt(r * r - dy * dy));
    fillRect(cx - dx, cy + dy, dx * 2 + 1, 1, c);
  }
}

function fillCircleA(cx: number, cy: number, r: number, c: RGB, a: number): void {
  for (let dy = -r; dy <= r; dy++) {
    const dx = Math.floor(Math.sqrt(r * r - dy * dy));
    for (let xx = cx - dx; xx <= cx + dx; xx++) blendPx(xx, cy + dy, c, a);
  }
}

function fillEllipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  for (let dy = -ry; dy <= ry; dy++) {
    const t = 1 - (dy * dy) / (ry * ry);
    if (t < 0) continue;
    const dx = Math.floor(rx * Math.sqrt(t));
    fillRect(cx - dx, cy + dy, dx * 2 + 1, 1, c);
  }
}

function fillEllipseA(cx: number, cy: number, rx: number, ry: number, c: RGB, a: number): void {
  for (let dy = -ry; dy <= ry; dy++) {
    const t = 1 - (dy * dy) / (ry * ry);
    if (t < 0) continue;
    const dx = Math.floor(rx * Math.sqrt(t));
    for (let xx = cx - dx; xx <= cx + dx; xx++) blendPx(xx, cy + dy, c, a);
  }
}

// Scanline fill for simple polygons (convex or concave, non self-intersecting).
function fillPolygon(pts: Array<[number, number]>, c: RGB): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of pts) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      fillRect(Math.ceil(xs[k]), y, Math.floor(xs[k + 1]) - Math.ceil(xs[k]) + 1, 1, c);
    }
  }
}

function line(x0: number, y0: number, x1: number, y1: number, c: RGB, w = 1): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  const r = Math.max(1, Math.floor(w / 2));
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    fillCircle(Math.round(x0 + dx * t), Math.round(y0 + dy * t), r, c);
  }
}

// Deterministic pseudo-random (mulberry32).
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function skyColor(t: number): RGB {
  for (let i = 1; i < SKY_STOPS.length; i++) {
    if (t <= SKY_STOPS[i][0]) {
      const [t0, c0] = SKY_STOPS[i - 1];
      const [t1, c1] = SKY_STOPS[i];
      const f = (t - t0) / (t1 - t0);
      return [lerp(c0[0], c1[0], f), lerp(c0[1], c1[1], f), lerp(c0[2], c1[2], f)].map(
        Math.round,
      ) as RGB;
    }
  }
  return SKY_STOPS[SKY_STOPS.length - 1][1];
}

// ---------------------------------------------------------------- 5x7 font
const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01110"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10011", "10101", "11001", "10001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  "'": ["00100", "00100", "00100", "00000", "00000", "00000", "00000"],
  ",": ["00000", "00000", "00000", "00000", "01100", "01100", "01000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
};

function drawText(text: string, cx: number, y: number, scale: number, c: RGB): void {
  const totalW = text.length * 6 * scale - scale;
  let x = Math.round(cx - totalW / 2);
  for (const ch of text) {
    const g = FONT[ch] ?? FONT[" "];
    for (let r = 0; r < 7; r++) {
      for (let col = 0; col < 5; col++) {
        if (g[r][col] === "1") {
          fillRect(x + col * scale, y + r * scale, scale, scale, c);
        }
      }
    }
    x += 6 * scale;
  }
}

// ---------------------------------------------------------------- scene
function drawPine(x: number, baseY: number, s: number): void {
  const trunk: RGB = [90, 60, 35];
  const pine: RGB = [46, 110, 62];
  const pineDark: RGB = [34, 84, 48];
  fillRect(x - 2 * s, baseY - 8 * s, 4 * s, 8 * s, trunk);
  fillPolygon(
    [
      [x - 9 * s, baseY - 6 * s],
      [x + 9 * s, baseY - 6 * s],
      [x, baseY - 22 * s],
    ],
    pine,
  );
  fillPolygon(
    [
      [x - 7 * s, baseY - 16 * s],
      [x + 7 * s, baseY - 16 * s],
      [x, baseY - 30 * s],
    ],
    pineDark,
  );
  fillPolygon(
    [
      [x - 5 * s, baseY - 25 * s],
      [x + 5 * s, baseY - 25 * s],
      [x, baseY - 37 * s],
    ],
    pine,
  );
}

function drawCloud(cx: number, cy: number, s: number, tint: RGB, alpha: number): void {
  fillEllipseA(cx, cy, 70 * s, 20 * s, tint, alpha);
  fillEllipseA(cx - 45 * s, cy + 6 * s, 45 * s, 15 * s, tint, alpha);
  fillEllipseA(cx + 48 * s, cy + 7 * s, 48 * s, 15 * s, tint, alpha);
  fillEllipseA(cx - 12 * s, cy - 12 * s, 38 * s, 16 * s, tint, alpha);
  fillEllipseA(cx + 22 * s, cy - 10 * s, 34 * s, 14 * s, tint, alpha);
}

function drawBird(x: number, y: number, s: number, c: RGB): void {
  line(x - s, y, x, y + Math.round(s * 0.45), c, 2);
  line(x, y + Math.round(s * 0.45), x + s, y, c, 2);
}

function drawIsland(cx: number, topY: number, rx: number, ry: number, rockDepth: number): void {
  // Rocky underside: inverted cone with strata.
  const rock: RGB = [122, 90, 72];
  const rockDark: RGB = [74, 52, 40];
  fillPolygon(
    [
      [cx - rx, topY],
      [cx + rx, topY],
      [cx + rx * 0.42, topY + rockDepth * 0.72],
      [cx, topY + rockDepth],
      [cx - rx * 0.42, topY + rockDepth * 0.72],
    ],
    rock,
  );
  // Strata lines on the rock.
  line(cx - rx * 0.72, topY + rockDepth * 0.3, cx + rx * 0.72, topY + rockDepth * 0.3, rockDark, 2);
  line(cx - rx * 0.55, topY + rockDepth * 0.55, cx + rx * 0.55, topY + rockDepth * 0.55, rockDark, 2);
  // Grassy top.
  fillEllipse(cx, topY, rx, ry, [77, 138, 79]);
  fillEllipse(cx, topY - 4, rx * 0.94, ry * 0.8, [96, 160, 92]);
}

function drawWaterfall(x: number, y0: number, y1: number): void {
  const water: RGB = [191, 227, 242];
  const foam: RGB = [255, 255, 255];
  for (let y = y0; y <= y1; y++) {
    const cx = x + Math.round(6 * Math.sin((y - y0) / 42));
    fillRect(cx - 7, y, 14, 1, water);
    if (y % 3 === 0) fillRect(cx - 3, y, 3, 1, foam);
    if (y % 7 === 0) fillRect(cx + 4, y, 2, 1, foam);
  }
  // Mist where the fall meets the clouds.
  fillEllipseA(x, y1 + 6, 62, 18, [234, 246, 255], 0.85);
  fillEllipseA(x - 30, y1 + 12, 40, 13, [255, 255, 255], 0.7);
}

function drawAirship(cx: number, cy: number): void {
  const rx = 72;
  const ry = 26;
  const cream: RGB = [247, 232, 200];
  const red: RGB = [201, 79, 61];
  // Striped envelope, drawn as vertical slices following the ellipse.
  for (let x = cx - rx; x <= cx + rx; x++) {
    const t = 1 - ((x - cx) * (x - cx)) / (rx * rx);
    if (t < 0) continue;
    const half = Math.floor(ry * Math.sqrt(t));
    const stripe = Math.floor((x - cx) / 15) % 2 === 0 ? cream : red;
    fillRect(x, cy - half, 1, half * 2 + 1, stripe);
  }
  // Gondola + rigging.
  line(cx - 18, cy + ry - 2, cx - 12, cy + ry + 12, [107, 74, 47], 2);
  line(cx + 18, cy + ry - 2, cx + 12, cy + ry + 12, [107, 74, 47], 2);
  fillRect(cx - 15, cy + ry + 12, 30, 12, [107, 74, 47]);
  fillRect(cx - 15, cy + ry + 12, 30, 3, [70, 46, 28]);
  // Tail fins.
  fillPolygon(
    [
      [cx - rx + 2, cy - 4],
      [cx - rx - 16, cy - 22],
      [cx - rx + 10, cy - 14],
    ],
    red,
  );
  fillPolygon(
    [
      [cx - rx + 2, cy + 4],
      [cx - rx - 16, cy + 22],
      [cx - rx + 10, cy + 14],
    ],
    red,
  );
}

function drawLighthouse(x: number, baseY: number): void {
  // White tower, red top, warm lamp.
  fillRect(x - 8, baseY - 52, 16, 52, [245, 240, 225]);
  fillRect(x - 8, baseY - 52, 16, 10, [201, 79, 61]);
  fillCircle(x, baseY - 56, 7, [201, 79, 61]);
  fillCircleA(x, baseY - 56, 13, [255, 230, 150], 0.55);
  fillCircle(x, baseY - 56, 4, [255, 240, 180]);
  fillRect(x - 3, baseY - 30, 6, 8, [40, 40, 60]);
}

function drawScene(): void {
  // Sky gradient (scene area 0..840).
  for (let y = 0; y < 840; y++) {
    const c = skyColor(y / 840);
    hline(0, W - 1, y, c);
  }

  // Stars in the upper sky.
  const rand = rng(20261121);
  for (let i = 0; i < 70; i++) {
    const x = 30 + Math.floor(rand() * 964);
    const y = 30 + Math.floor(rand() * 270);
    const a = 0.4 + rand() * 0.6;
    blendPx(x, y, WHITE, a);
    if (rand() > 0.7) blendPx(x + 1, y, WHITE, a * 0.6);
  }

  // Sun with glow, low over the cloud sea, clear of the islands so the
  // whole disc shows.
  fillCircleA(760, 490, 150, [255, 217, 138], 0.1);
  fillCircleA(760, 490, 118, [255, 217, 138], 0.14);
  fillCircleA(760, 490, 98, [255, 232, 170], 0.25);
  fillCircle(760, 490, 82, [255, 237, 184]);
  fillCircle(745, 475, 55, [255, 246, 216]);

  // A few drifting mid clouds.
  drawCloud(150, 520, 0.8, [255, 243, 224], 0.85);
  drawCloud(880, 560, 0.7, [255, 220, 200], 0.8);
  drawCloud(420, 620, 0.6, [255, 233, 210], 0.75);

  // Airship drifting left of the sun.
  drawAirship(300, 205);

  // Birds.
  const birdC: RGB = [60, 45, 70];
  drawBird(150, 180, 12, birdC);
  drawBird(185, 165, 9, birdC);
  drawBird(880, 200, 11, birdC);
  drawBird(920, 225, 8, birdC);
  drawBird(640, 150, 9, birdC);

  // Floating islands.
  drawIsland(215, 300, 120, 32, 120);
  drawPine(185, 296, 1);
  drawPine(240, 294, 0.8);

  drawIsland(835, 320, 100, 28, 95);
  drawPine(820, 316, 0.9);
  drawPine(860, 318, 0.7);

  // Central island — the landmark.
  drawIsland(512, 400, 250, 55, 240);
  drawPine(380, 392, 1.1);
  drawPine(455, 388, 0.9);
  drawPine(640, 392, 1.0);
  drawLighthouse(560, 396);

  // Waterfall off the central island into the cloud sea.
  drawWaterfall(600, 430, 780);

  // Sea of clouds at the bottom of the scene.
  drawCloud(180, 760, 1.5, [255, 243, 224], 0.95);
  drawCloud(520, 790, 1.7, [255, 228, 205], 0.95);
  drawCloud(860, 755, 1.4, [255, 243, 224], 0.95);
  drawCloud(340, 815, 1.2, [247, 184, 160], 0.9);
  drawCloud(700, 820, 1.2, [247, 184, 160], 0.9);

  // Gold rule, then the navy name band.
  fillRect(0, 840, W, 3, GOLD);
  fillRect(0, 843, W, H - 843, NAVY);

  // Tagline at the top, name big in the band.
  drawText("ISLANDS IN THE SKY", 512, 44, 4, GOLD);
  drawText("AERIDOR", 512, 862, 17, CREAM);

  // Double gold frame, drawn last so it sits over everything.
  for (let t = 0; t < 3; t++) {
    hline(10, 1014, 10 + t, GOLD);
    hline(10, 1014, 1014 - t, GOLD);
    fillRect(10 + t, 10, 1, 1005, GOLD);
    fillRect(1014 - t, 10, 1, 1005, GOLD);
  }
  hline(24, 1000, 24, GOLD);
  hline(24, 1000, 1000, GOLD);
  fillRect(24, 24, 1, 977, GOLD);
  fillRect(1000, 24, 1, 977, GOLD);
}

// ---------------------------------------------------------------- PNG encode
const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0; // filter: none
    buf.copy(raw, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- main
function main(): void {
  drawScene();
  const png = encodePNG();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "entry.png"), png);
  console.log(`entry.png: ${png.length} bytes, ${W}x${H}`);
  if (png.length > 1048576) {
    throw new Error("entry.png exceeds the 1,048,576 byte limit");
  }
}

main();
