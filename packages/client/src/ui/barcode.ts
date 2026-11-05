// Barcodes drawn from screen text, with no library: QR codes (ISO/IEC 18004,
// byte mode, error correction level M) and Code 128 (code sets B and C).
// The QR encoder follows the structure of Project Nayuki's reference
// implementation (MIT licence), cut down to what Veneer needs.

// ---- QR code -------------------------------------------------------------------

/** Error correction codewords per block, and blocks, for level M by version (index 0 unused). */
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
/** Level M's two format bits. */
const LEVEL_M = 0;

/** Modules (data and error correction bits) a version has room for. */
function rawModules(ver: number): number {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}

const dataCodewords = (ver: number) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver]! * BLOCKS[ver]!;
/** Bits of the byte mode's character count. */
const countBits = (ver: number) => (ver <= 9 ? 8 : 16);

// Reed-Solomon over GF(2^8) with the polynomial x^8 + x^4 + x^3 + x^2 + 1.
function multiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = multiply(result[j]!, root);
      if (j + 1 < result.length) result[j] = result[j]! ^ result[j + 1]!;
    }
    root = multiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => { result[i] = result[i]! ^ multiply(coef, factor); });
  }
  return result;
}

/** The codewords of `bytes`, error correction added and the blocks interleaved. */
function codewords(bytes: Uint8Array, ver: number): number[] {
  const capacity = dataCodewords(ver);
  const bits: number[] = [];
  const put = (value: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, countBits(ver));
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capacity * 8 - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);

  const blocks = BLOCKS[ver]!;
  const ecc = ECC_PER_BLOCK[ver]!;
  const raw = Math.floor(rawModules(ver) / 8);
  const short = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const divisor = rsDivisor(ecc);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const block = data.slice(k, k + shortLen - ecc + (i < short ? 0 : 1));
    k += block.length;
    const rem = rsRemainder(block, divisor);
    if (i < short) block.push(0);
    all.push([...block, ...rem]);
  }
  const out: number[] = [];
  for (let i = 0; i < all[0]!.length; i++) {
    all.forEach((block, j) => { if (i !== shortLen - ecc || j >= short) out.push(block[i]!); });
  }
  return out;
}

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const count = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const out = [6];
  for (let pos = ver * 4 + 10; out.length < count; pos -= step) out.splice(1, 0, pos);
  return out;
}

class Grid {
  readonly modules: boolean[][];
  readonly reserved: boolean[][];
  readonly size: number;
  constructor(size: number) {
    this.size = size;
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }
  /** Set a function module: column x, row y. */
  fn(x: number, y: number, dark: boolean): void {
    this.modules[y]![x] = dark;
    this.reserved[y]![x] = true;
  }
}

function drawFunctionPatterns(g: Grid, ver: number): void {
  const size = g.size;
  for (let i = 0; i < size; i++) {
    g.fn(6, i, i % 2 === 0);
    g.fn(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) g.fn(x, y, dist !== 2 && dist !== 4);
      }
    }
  }
  const align = alignmentPositions(ver);
  const last = align.length - 1;
  align.forEach((ax, i) => align.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) g.fn(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }));
  drawFormat(g, 0); // Reserved now, drawn for real once the mask is chosen.
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      g.fn(a, b, dark);
      g.fn(b, a, dark);
    }
  }
}

function drawFormat(g: Grid, mask: number): void {
  const data = (LEVEL_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) !== 0;
  const size = g.size;
  for (let i = 0; i <= 5; i++) g.fn(8, i, bit(i));
  g.fn(8, 7, bit(6));
  g.fn(8, 8, bit(7));
  g.fn(7, 8, bit(8));
  for (let i = 9; i < 15; i++) g.fn(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) g.fn(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) g.fn(8, size - 15 + i, bit(i));
  g.fn(8, size - 8, true);
}

function drawCodewords(g: Grid, data: readonly number[]): void {
  const size = g.size;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!g.reserved[y]![x] && i < data.length * 8) {
          g.modules[y]![x] = ((data[i >>> 3]! >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }
}

const MASKS: ReadonlyArray<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(g: Grid, mask: number): void {
  const test = MASKS[mask]!;
  for (let y = 0; y < g.size; y++) {
    for (let x = 0; x < g.size; x++) if (!g.reserved[y]![x] && test(x, y)) g.modules[y]![x] = !g.modules[y]![x];
  }
}

/** The standard's penalty for a finished symbol: lower reads better. */
function penalty(m: readonly boolean[][]): number {
  const size = m.length;
  const at = (x: number, y: number, vertical: boolean) => (vertical ? m[x]![y]! : m[y]![x]!);
  let score = 0;
  const finder = [true, false, true, true, true, false, true];
  for (const vertical of [false, true]) {
    for (let y = 0; y < size; y++) {
      // Runs of five or more alike.
      let run = 1;
      for (let x = 1; x <= size; x++) {
        if (x < size && at(x, y, vertical) === at(x - 1, y, vertical)) { run++; continue; }
        if (run >= 5) score += run - 2;
        run = 1;
      }
      // Finder-like 1:1:3:1:1 with four light modules on one side.
      for (let x = 0; x + 7 <= size; x++) {
        if (!finder.every((d, k) => at(x + k, y, vertical) === d)) continue;
        const light = (from: number) => [0, 1, 2, 3].every((k) => { const xx = from + k; return xx < 0 || xx >= size || !at(xx, y, vertical); });
        if (light(x - 4) || light(x + 7)) score += 40;
      }
    }
  }
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (m[y]![x]) dark++;
      if (x + 1 < size && y + 1 < size) {
        const c = m[y]![x];
        if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) score += 3;
      }
    }
  }
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/** The longest text, in UTF-8 bytes, a QR code can hold at level M (version 40). */
export const QR_MAX_BYTES = dataCodewords(40) - 3;

/**
 * A QR code for `text` (UTF-8, byte mode, level M), as rows of dark (true)
 * and light modules, without the quiet zone. The smallest version that fits;
 * `mask` forces one of the eight masks (for tests), else the best is chosen.
 * Undefined when the text is too long.
 */
export function qrCode(text: string, opts: { mask?: number; minVersion?: number } = {}): boolean[][] | undefined {
  const bytes = new TextEncoder().encode(text);
  let ver = Math.max(1, opts.minVersion ?? 1);
  while (ver <= 40 && 4 + countBits(ver) + bytes.length * 8 > dataCodewords(ver) * 8) ver++;
  if (ver > 40) return undefined;
  const data = codewords(bytes, ver);
  const make = (mask: number) => {
    const g = new Grid(ver * 4 + 17);
    drawFunctionPatterns(g, ver);
    drawCodewords(g, data);
    applyMask(g, mask);
    drawFormat(g, mask);
    return g.modules;
  };
  if (opts.mask !== undefined) return make(opts.mask);
  let best: boolean[][] | undefined;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = make(mask);
    const s = penalty(m);
    if (s < bestScore) { best = m; bestScore = s; }
  }
  return best;
}

// ---- Code 128 --------------------------------------------------------------------

/** Bar and space widths of each symbol value (0-102), the three starts (103-105) and stop (106). */
export const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
] as const;

const START_B = 104, START_C = 105, CODE_B = 100, CODE_C = 99, STOP = 106;

/**
 * The symbol values for `text` in Code 128, check symbol included: runs of
 * four or more digits are packed two to a symbol (code set C), the rest is
 * code set B. Undefined for characters Code 128 B can't hold (outside ASCII
 * 32-126) or empty text.
 */
export function code128Values(text: string): number[] | undefined {
  if (text === '' || ![...text].every((c) => c >= ' ' && c <= '~')) return undefined;
  const values: number[] = [];
  let set: 'B' | 'C' | undefined;
  let i = 0;
  const digitRun = (from: number) => {
    let n = 0;
    while (from + n < text.length && /\d/.test(text[from + n]!)) n++;
    return n;
  };
  while (i < text.length) {
    const run = digitRun(i);
    // Set C pays when a run is long enough: four digits, or two at the very start or end.
    const useC = run >= 4 || (run >= 2 && run === text.length - i && set === 'C');
    if (useC) {
      const pairs = Math.floor(run / 2);
      if (set !== 'C') values.push(set === undefined ? START_C : CODE_C);
      set = 'C';
      for (let k = 0; k < pairs; k++, i += 2) values.push(Number(text.slice(i, i + 2)));
      continue;
    }
    if (set !== 'B') values.push(set === undefined ? START_B : CODE_B);
    set = 'B';
    values.push(text.charCodeAt(i) - 32);
    i++;
  }
  const check = values.reduce((sum, v, k) => sum + v * Math.max(1, k), 0) % 103;
  return [...values, check, STOP];
}

/**
 * Code 128 as module widths, alternating bar and space and starting with a
 * bar, quiet zones not included. Undefined when the text can't be encoded.
 */
export function code128(text: string): number[] | undefined {
  const values = code128Values(text);
  return values?.flatMap((v) => [...CODE128_PATTERNS[v]!].map(Number));
}
