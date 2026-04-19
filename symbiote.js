// Board Gen Symbiote — v0.2
// Features:
//   1. Talestavern search — find slabs and send them to the GM's hand.
//   2. Restyle — paste a slab, swap its asset UUIDs for others from installed
//      content packs, send the restyled slab to the GM's hand.
//
// Slab V2 binary layout (Bouncyrock/DumbSlabStats format.md):
//   Header (10 B): u32 magic=0xD1CEFACE, u16 version=2, u16 layoutCount, u16 creatureCount=0
//   Layouts (20 B each, layoutCount of them): uuid (16 B) + u16 AssetCount + u16 _RESERVED_
//   Assets (8 B each, packed u64): bits [unused:5][rot:5][scaledZ:18][scaledY:18][scaledX:18]
//
// UUID byte order in slabs mirrors .NET Guid.ToByteArray:
//   bytes 0..3  = u32 LE  (first segment, 8 hex)
//   bytes 4..5  = u16 LE  (second, 4 hex)
//   bytes 6..7  = u16 LE  (third, 4 hex)
//   bytes 8..9  = u16 BE  (fourth, 4 hex)
//   bytes 10..13 = u32 BE (fifth-part-1, 8 hex)
//   bytes 14..15 = u16 BE (fifth-part-2, 4 hex)
//
// Restyle works by overwriting the 16 UUID bytes of a layout in-place and
// re-packing. Asset data is kept intact. Caveat: if the replacement tile has
// a different footprint / colliderBoundsBound, geometry may misalign.

const TT_ORIGIN = "https://talestavern.com";
const SLUG_BLOCKLIST = new Set(["page"]);

const $ = (id) => document.getElementById(id);
const status = (msg, cls) => {
  const el = $("status");
  el.textContent = msg;
  el.className = cls || "";
};

// ---------- Tabs ----------

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".panel").forEach((p) => (p.hidden = true));
    $(`panel-${tab.dataset.panel}`).hidden = false;
    if (tab.dataset.panel === "restyle") ensureContentPacksLoaded();
  });
});

// ================================================================
// Talestavern search
// ================================================================

const slabCache = new Map();

async function searchTalestavern(query) {
  const url = `${TT_ORIGIN}/?s=${encodeURIComponent(query)}&post_type=slab`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`search HTTP ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), "text/html");

  const seen = new Set();
  const results = [];
  for (const a of doc.querySelectorAll('a[href*="/slab/"]')) {
    const href = a.getAttribute("href") || "";
    const m = href.match(/^https?:\/\/talestavern\.com\/slab\/([^\/?#]+)\/?(?:$|[?#])/);
    if (!m) continue;
    const slug = m[1];
    if (SLUG_BLOCKLIST.has(slug) || seen.has(slug)) continue;
    seen.add(slug);
    const title = (a.textContent || "").trim() || slug;
    results.push({ slug, title, url: `${TT_ORIGIN}/slab/${slug}/` });
  }
  return results;
}

async function fetchTalestavernSlabString(slug) {
  if (slabCache.has(slug)) return slabCache.get(slug);
  const res = await fetch(`${TT_ORIGIN}/slab/${slug}/`);
  if (!res.ok) throw new Error(`slab page HTTP ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), "text/html");
  const ta = doc.querySelector("textarea.code") || doc.querySelector('textarea[class*="code"]');
  if (!ta) throw new Error("slab string not found on page");
  const slab = (ta.value || ta.textContent || "").trim();
  if (!slab) throw new Error("slab string empty");
  slabCache.set(slug, slab);
  return slab;
}

// ================================================================
// TaleSpire API wrappers
// ================================================================

function requireTS() {
  if (typeof TS === "undefined") {
    throw new Error("TaleSpire API not available — is this running inside TaleSpire?");
  }
}

// TS APIs signal failure by returning `{cause: "..."}` rather than throwing.
// Translate those into real Errors so `handleSlabSendError` can match on them.
function throwOnCause(result) {
  if (result && typeof result === "object" && !(result instanceof ArrayBuffer) && result.cause) {
    throw new Error(result.cause);
  }
  return result;
}

async function sendSlabToHand(slabString) {
  requireTS();
  throwOnCause(await TS.slabs.sendSlabToHand(slabString));
}

async function unpackSlab(slabString) {
  requireTS();
  return throwOnCause(await TS.slabs.unpack(slabString));
}

async function packSlab(buffer) {
  requireTS();
  return throwOnCause(await TS.slabs.pack(buffer));
}

// ================================================================
// UUID <-> bytes (.NET Guid.ToByteArray mixed-endian)
// ================================================================

function readUuidAt(view, offset) {
  const hex2 = (n) => n.toString(16).padStart(2, "0");
  const hex4 = (n) => n.toString(16).padStart(4, "0");
  const hex8 = (n) => n.toString(16).padStart(8, "0");
  return (
    hex8(view.getUint32(offset,      true))  + "-" +
    hex4(view.getUint16(offset + 4,  true))  + "-" +
    hex4(view.getUint16(offset + 6,  true))  + "-" +
    hex4(view.getUint16(offset + 8,  false)) + "-" +
    hex8(view.getUint32(offset + 10, false)) +
    hex4(view.getUint16(offset + 14, false))
  );
}

function writeUuidAt(view, offset, uuidString) {
  const hex = uuidString.replace(/-/g, "").toLowerCase();
  if (hex.length !== 32 || !/^[0-9a-f]+$/.test(hex)) {
    throw new Error(`invalid UUID: ${uuidString}`);
  }
  view.setUint32(offset,      parseInt(hex.slice(0, 8),   16), true);
  view.setUint16(offset + 4,  parseInt(hex.slice(8, 12),  16), true);
  view.setUint16(offset + 6,  parseInt(hex.slice(12, 16), 16), true);
  view.setUint16(offset + 8,  parseInt(hex.slice(16, 20), 16), false);
  view.setUint32(offset + 10, parseInt(hex.slice(20, 28), 16), false);
  view.setUint16(offset + 14, parseInt(hex.slice(28, 32), 16), false);
}

// ================================================================
// Slab parse + restyle
// ================================================================

function parseLayouts(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 10) throw new Error("slab truncated (header)");
  const magic = view.getUint32(0, true);
  if (magic !== 0xd1ceface) throw new Error(`bad magic 0x${magic.toString(16)}`);
  const version = view.getUint16(4, true);
  if (version !== 2) throw new Error(`unsupported slab version ${version}`);
  const layoutCount = view.getUint16(6, true);
  const layouts = [];
  for (let i = 0; i < layoutCount; i++) {
    const off = 10 + i * 20;
    if (off + 20 > buffer.byteLength) throw new Error("slab truncated (layouts)");
    layouts.push({
      index: i,
      offset: off,
      uuid: readUuidAt(view, off),
      assetCount: view.getUint16(off + 16, true),
    });
  }
  return { layoutCount, layouts };
}

function restyleBuffer(sourceBuffer, replacements) {
  // replacements: Map<sourceUuid, targetUuid>
  const copy = sourceBuffer.slice(0);
  const view = new DataView(copy);
  const { layouts } = parseLayouts(copy);
  let swapped = 0;
  for (const layout of layouts) {
    const target = replacements.get(layout.uuid);
    if (!target || target === layout.uuid) continue;
    writeUuidAt(view, layout.offset, target);
    swapped++;
  }
  return { buffer: copy, swapped };
}

// ================================================================
// Content packs (cached)
// ================================================================

let contentPacksPromise = null;
let contentPackInfos = null;

async function ensureContentPacksLoaded() {
  if (contentPackInfos) return contentPackInfos;
  if (contentPacksPromise) return contentPacksPromise;
  if (typeof TS === "undefined") return null;

  contentPacksPromise = (async () => {
    const fragments = await TS.contentPacks.getContentPacks();
    if (fragments && fragments.cause) throw new Error(`getContentPacks: ${fragments.cause}`);
    const infos = await TS.contentPacks.getMoreInfo(fragments);
    if (infos && infos.cause) throw new Error(`getMoreInfo: ${infos.cause}`);
    contentPackInfos = infos;
    rebuildAssetDatalist();
    return infos;
  })();
  try {
    return await contentPacksPromise;
  } catch (e) {
    contentPacksPromise = null;
    status(`Loading content packs failed: ${e.message}`, "warn");
    return null;
  }
}

function flattenedAssets() {
  if (!contentPackInfos) return [];
  const out = [];
  for (const pack of contentPackInfos) {
    const packName = pack.name || "Unknown pack";
    for (const t of pack.tiles || []) {
      if (!t.isDeprecated) out.push({ id: t.id, name: t.name, packName, kind: "tile", obj: t });
    }
    for (const p of pack.props || []) {
      if (!p.isDeprecated) out.push({ id: p.id, name: p.name, packName, kind: "prop", obj: p });
    }
  }
  return out;
}

// Display label used in the <datalist> options. Must be unique so we can
// round-trip back to a UUID.
function assetLabel(asset) {
  return `${asset.name} · ${asset.packName} [${asset.id.slice(0, 4)}]`;
}

let labelToUuid = new Map();

function rebuildAssetDatalist() {
  const dl = $("asset-options");
  dl.innerHTML = "";
  labelToUuid = new Map();
  for (const a of flattenedAssets()) {
    const label = assetLabel(a);
    labelToUuid.set(label, a.id);
    const opt = document.createElement("option");
    opt.value = label;
    dl.appendChild(opt);
  }
}

async function findAssetByUuid(uuid) {
  if (!contentPackInfos) await ensureContentPacksLoaded();
  if (!contentPackInfos) return null;
  try {
    const found = await TS.contentPacks.findBoardObjectInPacks(uuid, contentPackInfos);
    return found && found.boardObject ? found.boardObject : null;
  } catch {
    return null;
  }
}

// ================================================================
// UI — search panel
// ================================================================

function renderSearchResults(results) {
  const el = $("results");
  el.innerHTML = "";
  if (!results.length) { status("No slabs matched."); return; }
  for (const r of results) {
    const row = document.createElement("div");
    row.className = "result";
    const title = document.createElement("div");
    title.className = "title";
    const link = document.createElement("a");
    link.href = r.url; link.target = "_blank"; link.rel = "noopener noreferrer";
    link.textContent = r.title;
    title.appendChild(link);
    const btn = document.createElement("button");
    btn.textContent = "Send to hand";
    btn.addEventListener("click", () => onSendSearchResult(r, btn));
    row.appendChild(title);
    row.appendChild(btn);
    el.appendChild(row);
  }
  status(`${results.length} result${results.length === 1 ? "" : "s"}.`);
}

async function onSearch() {
  const q = $("query").value.trim();
  if (!q) { status("Enter a search term.", "warn"); return; }
  $("search").disabled = true;
  status(`Searching for "${q}"...`);
  try {
    renderSearchResults(await searchTalestavern(q));
  } catch (e) {
    status(`Search failed: ${e.message}`, "warn");
  } finally {
    $("search").disabled = false;
  }
}

async function onSendSearchResult(result, btn) {
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "…";
  try {
    const slab = await fetchTalestavernSlabString(result.slug);
    await sendSlabToHand(slab);
    status(`Sent "${result.title}" to your hand. Click in TaleSpire to place.`);
    btn.textContent = "Sent";
  } catch (e) {
    handleSlabSendError(e, result.title);
    btn.textContent = original;
    btn.disabled = false;
  }
}

// ================================================================
// UI — restyle panel
// ================================================================

let currentSlab = null; // { slabString, buffer, layouts }

async function onAnalyze() {
  const input = $("restyle-input").value.trim();
  $("restyle-layouts").innerHTML = "";
  $("restyle-apply").disabled = true;
  currentSlab = null;
  if (!input) { status("Paste a slab string first.", "warn"); return; }

  $("restyle-analyze").disabled = true;
  status("Analyzing slab...");
  try {
    const buffer = await unpackSlab(input);
    const { layouts } = parseLayouts(buffer);
    await ensureContentPacksLoaded();
    currentSlab = { slabString: input, buffer, layouts };
    await renderLayouts(layouts);
    const totalAssets = layouts.reduce((s, l) => s + l.assetCount, 0);
    status(`${layouts.length} unique asset kind${layouts.length === 1 ? "" : "s"}, ${totalAssets} placements. Pick replacements below.`);
  } catch (e) {
    status(`Analyze failed: ${e.message}`, "warn");
  } finally {
    $("restyle-analyze").disabled = false;
  }
}

async function renderLayouts(layouts) {
  const el = $("restyle-layouts");
  el.innerHTML = "";
  for (const layout of layouts) {
    const row = document.createElement("div");
    row.className = "layout-row";

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    const info = document.createElement("div");
    info.className = "info";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = `(unknown) ${layout.uuid.slice(0, 8)}`;
    const count = document.createElement("div");
    count.className = "count";
    count.textContent = `×${layout.assetCount}`;
    info.appendChild(name);
    info.appendChild(count);

    const arrow = document.createElement("div");
    arrow.className = "arrow";
    arrow.textContent = "→";

    const replacement = document.createElement("input");
    replacement.setAttribute("list", "asset-options");
    replacement.placeholder = "same (no swap)";
    replacement.dataset.sourceUuid = layout.uuid;
    replacement.addEventListener("input", onReplacementChange);

    row.appendChild(thumb);
    row.appendChild(info);
    row.appendChild(arrow);
    row.appendChild(replacement);
    el.appendChild(row);

    // Resolve name/thumbnail async without blocking.
    findAssetByUuid(layout.uuid).then(async (obj) => {
      if (!obj) { row.classList.add("unknown"); return; }
      name.textContent = obj.name || name.textContent;
      try {
        const t = await TS.contentPacks.createThumbnailElementForBoardObject(obj);
        if (t) { thumb.innerHTML = ""; thumb.appendChild(t); }
      } catch {}
    });
  }
}

function onReplacementChange() {
  const rows = document.querySelectorAll("#restyle-layouts .layout-row input");
  let valid = 0;
  let invalid = 0;
  for (const inp of rows) {
    const v = inp.value.trim();
    if (!v) continue;
    if (labelToUuid.has(v)) valid++;
    else invalid++;
  }
  $("restyle-apply").disabled = valid === 0 || invalid > 0;
  if (invalid > 0) status(`${invalid} replacement${invalid === 1 ? "" : "s"} don't match a known asset.`, "warn");
  else if (valid > 0) status(`${valid} swap${valid === 1 ? "" : "s"} ready. Click Send restyled slab.`);
}

async function onApplyRestyle() {
  if (!currentSlab) return;
  const replacements = new Map();
  for (const inp of document.querySelectorAll("#restyle-layouts .layout-row input")) {
    const v = inp.value.trim();
    if (!v) continue;
    const targetUuid = labelToUuid.get(v);
    if (!targetUuid) continue;
    replacements.set(inp.dataset.sourceUuid, targetUuid);
  }
  if (!replacements.size) { status("No swaps selected.", "warn"); return; }

  $("restyle-apply").disabled = true;
  status(`Restyling (${replacements.size} swap${replacements.size === 1 ? "" : "s"})...`);
  try {
    const { buffer, swapped } = restyleBuffer(currentSlab.buffer, replacements);
    const slabString = await packSlab(buffer);
    await sendSlabToHand(slabString);
    status(`Sent restyled slab (${swapped} swap${swapped === 1 ? "" : "s"}) to your hand. Click in TaleSpire to place.`);
  } catch (e) {
    handleSlabSendError(e, "restyled slab");
  } finally {
    $("restyle-apply").disabled = false;
  }
}

// ================================================================
// Shared error handling
// ================================================================

function handleSlabSendError(e, label) {
  const msg = String((e && e.message) || e);
  if (msg.includes("clientIsNotInGmMode")) {
    status(`${label}: slabs can only be placed by the GM.`, "warn");
  } else if (msg.includes("notInBoard")) {
    status(`${label}: open a board first.`, "warn");
  } else if (msg.includes("dataOversized")) {
    status(`${label}: slab exceeds TaleSpire's size limit.`, "warn");
  } else if (msg.includes("invalidSlabString")) {
    status(`${label}: invalid slab string.`, "warn");
  } else {
    status(`Failed (${label}): ${msg}`, "warn");
  }
}

// ================================================================
// Wire-up
// ================================================================

$("search").addEventListener("click", onSearch);
$("search-form").addEventListener("submit", onSearch);
$("restyle-analyze").addEventListener("click", onAnalyze);
$("restyle-apply").addEventListener("click", onApplyRestyle);
