// A small QR code encoder for the phone pairing link (no dependencies): byte mode, error
// correction level M (about 15% of the code can be damaged), versions 1 to 10, up to 213
// bytes. Follows ISO/IEC 18004, the way Project Nayuki's reference encoder lays it out.
//   qrMatrix(text) → rows of booleans (true = dark);  qrSvg(text) → an SVG drawing.

// Level M, per version: [data codewords per block, …] and error correction codewords per block.
const BLOCKS = {
  1: [[16], 10], 2: [[28], 16], 3: [[44], 26], 4: [[32, 32], 18], 5: [[43, 43], 24],
  6: [[27, 27, 27, 27], 16], 7: [[31, 31, 31, 31], 18], 8: [[38, 38, 39, 39], 22],
  9: [[36, 36, 36, 37, 37], 22], 10: [[43, 43, 43, 43, 44], 26],
};
const ALIGNMENT = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
const REMAINDER_BITS = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0 };
const FORMAT_M = 0; // error correction level M's two format bits

// ---------- Reed–Solomon over GF(256), polynomial x^8 + x^4 + x^3 + x^2 + 1
function multiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
  return z;
}
function divisor(degree) {
  const result = new Array(degree).fill(0); result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) { result[j] = multiply(result[j], root); if (j + 1 < degree) result[j] ^= result[j + 1]; }
    root = multiply(root, 0x02);
  }
  return result;
}
function remainder(data, div) {
  const result = new Array(div.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift(); result.push(0);
    div.forEach((coefficient, i) => { result[i] ^= multiply(coefficient, factor); });
  }
  return result;
}

// ---------- codewords
function codewords(bytes) {
  const version = Object.keys(BLOCKS).map(Number).find(v => BLOCKS[v][0].reduce((a, b) => a + b) * 8 >= 4 + (v < 10 ? 8 : 16) + bytes.length * 8);
  if (!version) throw new Error('Too long for a QR code here (213 bytes at most).');
  const [lengths, eccLength] = BLOCKS[version], capacity = lengths.reduce((a, b) => a + b);
  const bits = [];
  const put = (value, count) => { for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  put(0b0100, 4); put(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) put(byte, 8);
  put(0, Math.min(4, capacity * 8 - bits.length));
  put(0, (8 - bits.length % 8) % 8);
  for (let pad = 0xec; bits.length < capacity * 8; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((byte, bit) => byte << 1 | bit, 0));
  const blocks = [], div = divisor(eccLength);
  let at = 0;
  for (const length of lengths) { const block = data.slice(at, at + length); at += length; blocks.push({ data: block, ecc: remainder(block, div) }); }
  const out = [];
  for (let i = 0; i < Math.max(...lengths); i++) for (const block of blocks) if (i < block.data.length) out.push(block.data[i]);
  for (let i = 0; i < eccLength; i++) for (const block of blocks) out.push(block.ecc[i]);
  return { version, words: out };
}

// ---------- the matrix
const MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
  (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0,
];
function build(version, words, mask) {
  const size = version * 4 + 17;
  const dark = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, value) => { dark[y][x] = value; fixed[y][x] = true; };
  // Timing lines, then the three finder squares (with their light borders) and alignment squares.
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  const centres = ALIGNMENT[version], last = centres.length - 1;
  for (let i = 0; i <= last; i++) for (let j = 0; j <= last; j++) {
    if (i === 0 && j === 0 || i === 0 && j === last || i === last && j === 0) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(centres[i] + dx, centres[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // Format bits (level and mask), twice, and the one always-dark module.
  const format = (() => { const data = FORMAT_M << 3 | mask; let rem = data; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537); return (data << 10 | rem) ^ 0x5412; })();
  const bit = (value, i) => ((value >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i++) set(8, i, bit(format, i));
  set(8, 7, bit(format, 6)); set(8, 8, bit(format, 7)); set(7, 8, bit(format, 8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(format, i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(format, i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(format, i));
  set(8, size - 8, true);
  // Version bits, from version 7.
  if (version >= 7) {
    let rem = version; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = version << 12 | rem;
    for (let i = 0; i < 18; i++) { const a = size - 11 + i % 3, b = Math.floor(i / 3); set(a, b, bit(bits, i)); set(b, a, bit(bits, i)); }
  }
  // Data, in two-column zigzags from the bottom right, skipping the vertical timing line.
  const total = words.length * 8 + REMAINDER_BITS[version];
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
      if (fixed[y][x] || i >= total) continue;
      dark[y][x] = i < words.length * 8 && bit(words[i >>> 3], 7 - (i & 7));
      i++;
    }
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && MASKS[mask](x, y)) dark[y][x] = !dark[y][x];
  return dark;
}

// The mask that's easiest to scan (fewest long runs, blocks, finder look-alikes, imbalance).
function penalty(m) {
  const size = m.length; let score = 0;
  const lines = [...m, ...m[0].map((_, x) => m.map(row => row[x]))];
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else { if (run >= 5) score += run - 2; run = 1; }
    }
    const text = line.map(v => v ? 1 : 0).join('');
    for (const pattern of ['10111010000', '00001011101']) for (let at = text.indexOf(pattern); at !== -1; at = text.indexOf(pattern, at + 1)) score += 40;
  }
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const v = m[y][x]; if (v === m[y][x + 1] && v === m[y + 1][x] && v === m[y + 1][x + 1]) score += 3; }
  const darkCount = m.flat().filter(Boolean).length;
  return score + 10 * Math.floor(Math.abs(darkCount * 100 / (size * size) - 50) / 5);
}

export function qrMatrix(text) {
  const { version, words } = codewords([...new TextEncoder().encode(text)]);
  let best = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) { const m = build(version, words, mask), score = penalty(m); if (score < bestScore) { best = m; bestScore = score; } }
  return best;
}

// Dark squares on a light background with the standard four-module quiet zone.
export function qrSvg(text, { label = 'QR code' } = {}) {
  const m = qrMatrix(text), size = m.length + 8;
  let path = '';
  m.forEach((row, y) => row.forEach((on, x) => { if (on) path += `M${x + 4} ${y + 4}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="${label.replace(/[<>&"]/g, '')}"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
