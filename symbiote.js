// Board Gen Symbiote — v0.0.1 skeleton
//
// Procedural board generator for TaleSpire. This file is a stub: the generators
// run entirely in-Symbiote to produce a grid of (tile-id, x, y, z) placements,
// and the final `placeTiles` step hands them to the TaleSpire Symbiote API.
//
// Nothing here is wired to real TS API calls yet — we need to confirm the
// tile-placement surface before writing against it.

const $ = (id) => document.getElementById(id);
const status = (msg) => { $("status").textContent = msg; };

// ---------- seeded RNG ----------

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngFromSeed(seedStr) {
  const s = seedStr || String(Math.random());
  return mulberry32(xmur3(s)());
}

// ---------- generators ----------

const generators = {
  dungeon(w, h, rng) {
    // Placeholder: carves N random rooms and connects them with L-shaped
    // corridors. Returns a 2D array where 1 = floor, 0 = wall.
    const grid = Array.from({ length: h }, () => new Array(w).fill(0));
    const rooms = [];
    const n = 5 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) {
      const rw = 3 + Math.floor(rng() * 6);
      const rh = 3 + Math.floor(rng() * 6);
      const rx = 1 + Math.floor(rng() * (w - rw - 2));
      const ry = 1 + Math.floor(rng() * (h - rh - 2));
      for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) grid[y][x] = 1;
      rooms.push({ cx: rx + (rw >> 1), cy: ry + (rh >> 1) });
    }
    for (let i = 1; i < rooms.length; i++) {
      const a = rooms[i - 1], b = rooms[i];
      const [x0, x1] = a.cx < b.cx ? [a.cx, b.cx] : [b.cx, a.cx];
      const [y0, y1] = a.cy < b.cy ? [a.cy, b.cy] : [b.cy, a.cy];
      for (let x = x0; x <= x1; x++) grid[a.cy][x] = 1;
      for (let y = y0; y <= y1; y++) grid[y][b.cx] = 1;
    }
    return grid;
  },
};

// ---------- placement ----------
// TODO: map grid cells to TaleSpire tile content-pack UUIDs, then call the
// Symbiote tile-placement API for each cell. This needs API verification
// before implementing — see README.

async function placeTiles(grid) {
  // Placeholder: for now just report the stats.
  const floors = grid.flat().filter((v) => v === 1).length;
  status(`Generated ${grid[0].length} x ${grid.length} board, ${floors} floor tiles. (Placement not wired up yet.)`);
}

// ---------- wire-up ----------

$("generate").addEventListener("click", async () => {
  const w = parseInt($("width").value, 10);
  const h = parseInt($("height").value, 10);
  const seed = $("seed").value.trim();
  const gen = $("generator").value;
  const rng = rngFromSeed(seed);
  try {
    const grid = generators[gen](w, h, rng);
    await placeTiles(grid);
  } catch (e) {
    status(`Generate failed: ${e.message}`);
  }
});

status("Ready. Enter params and click Generate.");
