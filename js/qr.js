/* My Kasir — QRIS QR code generator.
 *
 * A compact but standards-correct QR encoder (model 2, byte mode, with
 * Reed-Solomon error correction). Written from scratch so the app keeps its
 * zero-dependency promise while still producing scannable codes.
 *
 * Reference: ISO/IEC 18004.
 */

/* --- Galois field GF(256) ------------------------------------------------ */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(function initTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // x^8 + x^4 + x^3 + x^2 + 1
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/**
 * Reed-Solomon generator polynomial of the given degree.
 * Returned highest-degree-first, so gen[0] is the coefficient of x^degree
 * (which is always 1) and gen[degree] is the constant term.
 */
function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    // multiply by (x + a^i)
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];                    // * x
      next[j + 1] ^= gfMul(poly[j], EXP[i]);  // * a^i
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const res = new Uint8Array(data.length + ecLen);
  res.set(data);

  for (let i = 0; i < data.length; i++) {
    const factor = res[i];
    if (factor === 0) continue;
    for (let j = 1; j < gen.length; j++) {
      res[i + j] ^= gfMul(gen[j], factor);
    }
  }
  return res.slice(data.length);
}

/* --- Version / capacity -------------------------------------------------- */

/* EC codewords per block, per version (1-40), for the four EC levels.
 * Indexed as: VERSIONS[v][ecLevel] = [ecCodewordsPerBlock, group1Blocks, group1DataCodewords, group2Blocks, group2DataCodewords]
 */
const EC_TABLE = {
  L: [
    [7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0],
    [26, 1, 108, 0, 0], [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0],
    [30, 2, 116, 0, 0], [18, 2, 68, 2, 69], [20, 4, 81, 0, 0], [24, 2, 92, 2, 93],
    [26, 4, 107, 0, 0], [30, 3, 115, 1, 116], [22, 5, 87, 1, 88], [24, 5, 98, 1, 99],
    [28, 1, 107, 5, 108], [30, 5, 120, 1, 121], [28, 3, 113, 4, 114], [28, 3, 107, 5, 108],
    [28, 4, 116, 4, 117], [28, 2, 111, 7, 112], [30, 4, 121, 5, 122], [30, 6, 117, 4, 118],
    [26, 8, 106, 4, 107], [28, 10, 114, 2, 115], [30, 8, 122, 4, 123], [30, 3, 117, 10, 118],
    [30, 7, 116, 7, 117], [30, 5, 115, 10, 116], [30, 13, 115, 3, 116], [30, 17, 115, 0, 0],
  ],
  M: [
    [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0],
    [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39],
    [22, 3, 36, 2, 37], [26, 4, 43, 1, 44], [30, 1, 50, 4, 51], [22, 6, 36, 2, 37],
    [22, 8, 37, 1, 38], [24, 4, 40, 5, 41], [24, 5, 41, 5, 42], [28, 7, 45, 3, 46],
    [28, 10, 46, 1, 47], [26, 9, 43, 4, 44], [26, 3, 44, 11, 45], [26, 3, 41, 13, 42],
    [26, 17, 42, 0, 0], [28, 17, 46, 0, 0], [28, 4, 47, 14, 48], [28, 6, 45, 14, 46],
    [28, 8, 47, 13, 48], [28, 19, 46, 4, 47], [28, 22, 47, 3, 48], [30, 3, 45, 23, 46],
    [30, 23, 48, 0, 0], [30, 23, 48, 0, 0], [30, 25, 47, 0, 0], [30, 29, 46, 0, 0],
  ],
  Q: [
    [13, 1, 13, 0, 0], [22, 1, 22, 0, 0], [18, 2, 17, 0, 0], [26, 2, 24, 0, 0],
    [18, 2, 15, 2, 16], [24, 4, 19, 0, 0], [18, 2, 14, 4, 15], [22, 4, 18, 2, 19],
    [20, 4, 16, 4, 17], [24, 6, 19, 2, 20], [28, 4, 22, 4, 23], [26, 4, 20, 6, 21],
    [24, 8, 20, 4, 21], [20, 11, 16, 5, 17], [30, 5, 24, 7, 25], [24, 15, 19, 2, 20],
    [28, 1, 22, 15, 23], [28, 17, 22, 1, 23], [26, 17, 21, 4, 22], [30, 15, 24, 5, 25],
    [28, 17, 22, 6, 23], [30, 7, 24, 16, 25], [30, 11, 24, 14, 25], [30, 11, 24, 16, 25],
    [30, 7, 25, 22, 26], [28, 28, 22, 6, 23], [30, 8, 23, 26, 24], [30, 4, 24, 31, 25],
    [30, 1, 28, 37, 29], [30, 15, 21, 25, 22], [30, 42, 21, 1, 22], [30, 10, 26, 35, 27],
  ],
  H: [
    [17, 1, 9, 0, 0], [28, 1, 16, 0, 0], [22, 2, 13, 0, 0], [16, 4, 9, 0, 0],
    [22, 2, 11, 2, 12], [28, 4, 15, 0, 0], [26, 4, 13, 1, 14], [26, 4, 14, 2, 15],
    [24, 4, 12, 4, 13], [28, 6, 15, 2, 16], [24, 3, 12, 8, 13], [28, 7, 14, 4, 15],
    [22, 12, 11, 4, 12], [24, 11, 12, 5, 13], [24, 11, 12, 7, 13], [30, 3, 15, 15, 16],
    [28, 2, 14, 17, 15], [28, 2, 14, 19, 15], [26, 9, 13, 16, 14], [28, 15, 15, 10, 16],
    [30, 19, 16, 6, 17], [24, 34, 13, 0, 0], [30, 16, 15, 14, 16], [30, 30, 16, 2, 17],
    [30, 22, 15, 13, 16], [30, 33, 16, 4, 17], [30, 12, 15, 28, 16], [30, 11, 15, 31, 16],
    [30, 19, 15, 26, 16], [30, 23, 15, 25, 16], [30, 23, 15, 28, 16], [30, 19, 15, 35, 16],
    [30, 11, 15, 46, 16], [30, 59, 16, 1, 17], [30, 22, 15, 41, 16], [30, 2, 15, 64, 16],
  ],
};

/** Alignment pattern centre coordinates per version. */
const ALIGN_POS = {
  1: [],
  2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  11: [6, 30, 54], 12: [6, 32, 58], 13: [6, 34, 62], 14: [6, 26, 46, 66],
  15: [6, 26, 48, 70], 16: [6, 26, 50, 74], 17: [6, 30, 54, 78],
  18: [6, 30, 56, 82], 19: [6, 30, 58, 86], 20: [6, 34, 62, 90],
  21: [6, 28, 50, 72, 94], 22: [6, 26, 50, 74, 98], 23: [6, 30, 54, 78, 102],
  24: [6, 28, 54, 80, 106], 25: [6, 32, 58, 84, 110], 26: [6, 30, 58, 86, 114],
  27: [6, 34, 62, 90, 118], 28: [6, 26, 50, 74, 98, 122], 29: [6, 30, 54, 78, 102, 126],
  30: [6, 26, 52, 78, 104, 130], 31: [6, 30, 56, 82, 108, 134],
  32: [6, 34, 60, 86, 112, 138], 33: [6, 30, 58, 86, 114, 142],
  34: [6, 34, 62, 90, 118, 146], 35: [6, 30, 54, 78, 102, 126, 150],
  36: [6, 24, 50, 76, 102, 128, 154], 37: [6, 28, 54, 80, 106, 132, 158],
  38: [6, 32, 58, 84, 110, 136, 162], 39: [6, 26, 54, 82, 110, 138, 166],
  40: [6, 30, 58, 86, 114, 142, 170],
};

/** Version information (versions 7-40) — 18 bits each. */
const VERSION_INFO = [
  0x07c94, 0x085bc, 0x09a99, 0x0a4d3, 0x0bbf6, 0x0c762, 0x0d847, 0x0e60d,
  0x0f928, 0x10b78, 0x1145d, 0x12a17, 0x13532, 0x149a6, 0x15683, 0x168c9,
  0x177ec, 0x18ec4, 0x191e1, 0x1afab, 0x1b08e, 0x1cc1a, 0x1d33f, 0x1ed75,
  0x1f250, 0x209d5, 0x216f0, 0x228ba, 0x2379f, 0x24b0b, 0x2542e, 0x26a64,
  0x27541, 0x28c69,
];

/* --- Encoder ------------------------------------------------------------- */

function utf8Bytes(str) {
  return Array.from(new TextEncoder().encode(str));
}

function charCountBits(version, mode) {
  // byte mode only — count bits for versions 1-9 and 10-40
  return version <= 9 ? 8 : 16;
}

function totalDataCodewords(version, ecLevel) {
  const [ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data] = EC_TABLE[ecLevel][version - 1];
  return g1Blocks * g1Data + g2Blocks * g2Data;
}

function pickVersion(byteLen, ecLevel) {
  for (let v = 1; v <= 40; v++) {
    const capacityBits = totalDataCodewords(v, ecLevel) * 8;
    const lenBits = charCountBits(v, 4);
    const needed = 4 + lenBits + byteLen * 8;
    if (needed <= capacityBits) return v;
  }
  throw new Error('Data terlalu besar untuk QR');
}

/** Build the final bit stream. */
function buildCodewords(bytes, version, ecLevel) {
  const bits = [];
  const push = (value, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  const lenBits = charCountBits(version, 4);
  push(0b0100, 4);            // byte mode
  push(bytes.length, lenBits); // character count
  for (const b of bytes) push(b, 8);

  const totalDataBits = totalDataCodewords(version, ecLevel) * 8;
  // terminator
  const terminator = Math.min(4, totalDataBits - bits.length);
  push(0, terminator);
  // pad to byte boundary
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCodewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    dataCodewords.push(byte);
  }

  // pad bytes
  const PAD = [0xec, 0x11];
  let padIdx = 0;
  while (dataCodewords.length < totalDataCodewords(version, ecLevel)) {
    dataCodewords.push(PAD[padIdx % 2]);
    padIdx++;
  }

  // split into blocks, compute EC, interleave
  const [ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data] = EC_TABLE[ecLevel][version - 1];
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < g1Blocks; i++) {
    const chunk = dataCodewords.slice(offset, offset + g1Data);
    offset += g1Data;
    blocks.push({ data: chunk, ec: rsEncode(chunk, ecPerBlock) });
  }
  for (let i = 0; i < g2Blocks; i++) {
    const chunk = dataCodewords.slice(offset, offset + g2Data);
    offset += g2Data;
    blocks.push({ data: chunk, ec: rsEncode(chunk, ecPerBlock) });
  }

  const result = [];
  const maxData = Math.max(g1Data, g2Data);
  for (let i = 0; i < maxData; i++) {
    for (const b of blocks) if (i < b.data.length) result.push(b.data[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const b of blocks) result.push(b.ec[i]);
  }
  return result;
}

/** Render the QR matrix. Returns a boolean[][] of size. */
function buildMatrix(codewords, version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(null));
  // function modules (finders, timing, format, version) must never be masked
  const isFunc = Array.from({ length: size }, () => new Array(size).fill(false));

  const setFunc = (row, col, value = false) => {
    if (row < 0 || row >= size || col < 0 || col >= size) return;
    modules[row][col] = value;
    isFunc[row][col] = true;
  };

  // timing patterns
  for (let i = 0; i < size; i++) {
    if (i !== 6) {
      setFunc(6, i);
      setFunc(i, 6);
    }
  }
  for (let i = 0; i < size; i++) {
    if (i !== 6) {
      modules[6][i] = i % 2 === 0;
      modules[i][6] = i % 2 === 0;
    }
  }

  // finder patterns (with separators)
  const finder = (row, col) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r;
        const cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        setFunc(rr, cc, inRing || inCore);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // alignment patterns
  const aligns = ALIGN_POS[version];
  for (const r of aligns) {
    for (const c of aligns) {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          setFunc(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  // reserve format info areas
  for (let i = 0; i < 9; i++) {
    if (modules[8][i] === null) setFunc(8, i);
    if (modules[i][8] === null) setFunc(i, 8);
  }
  for (let i = 0; i < 8; i++) {
    if (modules[8][size - 1 - i] === null) setFunc(8, size - 1 - i);
    if (modules[size - 1 - i][8] === null) setFunc(size - 1 - i, 8);
  }
  // dark module
  setFunc(size - 8, 8, true);

  // reserve version info (v >= 7)
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        setFunc(i, size - 11 + j);
        setFunc(size - 11 + j, i);
      }
    }
  }

  // place data
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  const nextBit = () => {
    if (bitIndex >= totalBits) return false;
    const bit = (codewords[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
    bitIndex++;
    return bit === 1;
  };

  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // skip vertical timing column
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (modules[row][cc] === null) modules[row][cc] = nextBit();
      }
    }
    upward = !upward;
  }

  // apply masks and pick the best by penalty
  return applyBestMask(modules, isFunc, size, version);
}

const MASK_FNS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyBestMask(modules, isFunc, size, version) {
  let best = null;
  let bestScore = Infinity;

  for (let mask = 0; mask < 8; mask++) {
    const copy = modules.map((row) => row.slice());
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (isFunc[r][c]) continue;
        if (modules[r][c] === null) continue;
        if (MASK_FNS[mask](r, c)) copy[r][c] = !copy[r][c];
      }
    }
    placeFormatInfo(copy, size, mask, version);
    if (version >= 7) placeVersionInfo(copy, size, version);
    const score = penalty(copy, size);
    if (score < bestScore) {
      bestScore = score;
      best = copy;
    }
  }
  return best;
}

const EC_BITS = { L: 1, M: 0, Q: 3, H: 2 };

/**
 * Place the 15-bit format information in both copies.
 *
 * Bit order is least-significant-bit first along the path
 *   (8,0) (8,1) (8,2) (8,3) (8,4) (8,5) (8,7) (8,8) (7,8) (5,8) (4,8) (3,8) (2,8) (1,8) (0,8)
 * and the second copy runs the other way around the bottom-left / top-right
 * corners.
 */
function placeFormatInfo(modules, size, mask, version) {
  const data = (EC_BITS.M << 3) | mask; // EC level M
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  const format = ((data << 10) | rem) ^ 0x5412;

  const copy1 = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  const copy2 = [
    [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8], [size - 5, 8],
    [size - 6, 8], [size - 7, 8], [8, size - 8], [8, size - 7], [8, size - 6],
    [8, size - 5], [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1],
  ];

  // The 15-bit format string runs most-significant-bit first along the path.
  const write = (coords) => {
    coords.forEach(([r, c], idx) => {
      modules[r][c] = ((format >> (14 - idx)) & 1) === 1;
    });
  };

  write(copy1);
  write(copy2);

  modules[size - 8][8] = true; // dark module
}

function placeVersionInfo(modules, size, version) {
  const rem = VERSION_INFO[version - 7];
  for (let i = 0; i < 18; i++) {
    const bit = ((rem >> i) & 1) === 1;
    const a = Math.floor(i / 3);
    const b = (i % 3) + size - 11;
    modules[a][b] = bit;
    modules[b][a] = bit;
  }
}

function penalty(m, size) {
  let score = 0;

  // rule 1: runs of 5+
  for (let i = 0; i < size; i++) {
    for (const horizontal of [true, false]) {
      let run = 1;
      let prev = horizontal ? m[0][i] : m[i][0];
      for (let j = 1; j < size; j++) {
        const cur = horizontal ? m[i][j] : m[j][i];
        if (cur === prev) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
          prev = cur;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }

  // rule 2: 2x2 blocks
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  }

  // rule 3: finder-like patterns
  const pat1 = [true, false, true, true, true, false, true, false, false, false, false];
  const pat2 = [false, false, false, false, true, false, true, true, true, false, true];
  for (let i = 0; i < size; i++) {
    for (let j = 0; j <= size - 11; j++) {
      let h1 = true, h2 = true, v1 = true, v2 = true;
      for (let k = 0; k < 11; k++) {
        if (m[i][j + k] !== pat1[k]) h1 = false;
        if (m[i][j + k] !== pat2[k]) h2 = false;
        if (m[j + k][i] !== pat1[k]) v1 = false;
        if (m[j + k][i] !== pat2[k]) v2 = false;
      }
      if (h1) score += 40;
      if (h2) score += 40;
      if (v1) score += 40;
      if (v2) score += 40;
    }
  }

  // rule 4: dark ratio
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) dark++;
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return score;
}

/* --- Public API ---------------------------------------------------------- */

/**
 * Render a QR code into a canvas element.
 * @param {string} text  payload
 * @param {object} opts  { size, margin, dark, light }
 * @returns {HTMLCanvasElement}
 */
export function qrCanvas(text, opts = {}) {
  const { size = 240, margin = 3, dark = '#10162b', light = '#ffffff' } = opts;

  const bytes = utf8Bytes(text);
  const version = pickVersion(bytes.length, 'M');
  const codewords = buildCodewords(bytes, version, 'M');
  const matrix = buildMatrix(codewords, version);

  const dim = matrix.length;
  const total = dim + margin * 2;

  const cv = document.createElement('canvas');
  cv.width = total;
  cv.height = total;
  const ctx = cv.getContext('2d');

  ctx.fillStyle = light;
  ctx.fillRect(0, 0, total, total);
  ctx.fillStyle = dark;

  for (let r = 0; r < dim; r++) {
    for (let c = 0; c < dim; c++) {
      if (matrix[r][c]) {
        ctx.fillRect(c + margin, r + margin, 1, 1);
      }
    }
  }

  cv.dataset.scale = String(size / total);
  return cv;
}

/** Render a QR code as a standalone SVG string. */
export function qrSvg(text, opts = {}) {
  const { margin = 3, dark = '#10162b', light = '#ffffff' } = opts;
  const bytes = utf8Bytes(text);
  const version = pickVersion(bytes.length, 'M');
  const codewords = buildCodewords(bytes, version, 'M');
  const matrix = buildMatrix(codewords, version);
  const dim = matrix.length;
  const total = dim + margin * 2;

  let path = '';
  for (let r = 0; r < dim; r++) {
    for (let c = 0; c < dim; c++) {
      if (matrix[r][c]) path += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total}" height="${total}"><rect width="${total}" height="${total}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}
