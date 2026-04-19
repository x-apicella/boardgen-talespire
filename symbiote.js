// Board Gen Symbiote — v0.1
// Feature 1: search Talestavern and send slabs to the GM's hand.
//
// Talestavern is a WordPress site with no public REST API; search is scraped
// from the HTML search page, and each slab page embeds its slab string in a
// <textarea class="code">. CORS is open (`access-control-allow-origin: *`),
// so the Symbiote can fetch directly with no proxy.

const TT_ORIGIN = "https://talestavern.com";
const SLUG_BLOCKLIST = new Set(["page"]); // non-slab paths under /slab/...

const $ = (id) => document.getElementById(id);
const status = (msg, cls) => {
  const el = $("status");
  el.textContent = msg;
  el.className = cls || "";
};

const slabCache = new Map(); // slug -> slabString

// ---------- Talestavern ----------

async function searchTalestavern(query) {
  const url = `${TT_ORIGIN}/?s=${encodeURIComponent(query)}&post_type=slab`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`search HTTP ${res.status}`);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

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

async function fetchSlabString(slug) {
  if (slabCache.has(slug)) return slabCache.get(slug);
  const res = await fetch(`${TT_ORIGIN}/slab/${slug}/`);
  if (!res.ok) throw new Error(`slab page HTTP ${res.status}`);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const ta = doc.querySelector("textarea.code") || doc.querySelector('textarea[class*="code"]');
  if (!ta) throw new Error("slab string not found on page");
  const slab = (ta.value || ta.textContent || "").trim();
  if (!slab) throw new Error("slab string empty");
  slabCache.set(slug, slab);
  return slab;
}

// ---------- TaleSpire ----------

async function sendSlabToHand(slabString) {
  if (typeof TS === "undefined" || !TS.slabs) {
    throw new Error("TaleSpire API not available — is this running inside TaleSpire?");
  }
  await TS.slabs.sendSlabToHand(slabString);
}

// ---------- UI ----------

function renderResults(results) {
  const el = $("results");
  el.innerHTML = "";
  if (!results.length) {
    status("No slabs matched.");
    return;
  }
  for (const r of results) {
    const row = document.createElement("div");
    row.className = "result";
    const title = document.createElement("div");
    title.className = "title";
    const link = document.createElement("a");
    link.href = r.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = r.title;
    title.appendChild(link);
    const btn = document.createElement("button");
    btn.textContent = "Send to hand";
    btn.addEventListener("click", () => onSend(r, btn));
    row.appendChild(title);
    row.appendChild(btn);
    el.appendChild(row);
  }
  status(`${results.length} result${results.length === 1 ? "" : "s"}. Click "Send to hand" to load a slab.`);
}

async function onSearch() {
  const q = $("query").value.trim();
  if (!q) { status("Enter a search term.", "warn"); return; }
  $("search").disabled = true;
  status(`Searching for "${q}"...`);
  try {
    const results = await searchTalestavern(q);
    renderResults(results);
  } catch (e) {
    status(`Search failed: ${e.message}`, "warn");
  } finally {
    $("search").disabled = false;
  }
}

async function onSend(result, btn) {
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "…";
  try {
    const slab = await fetchSlabString(result.slug);
    await sendSlabToHand(slab);
    status(`Sent "${result.title}" to your hand. Click in TaleSpire to place.`);
    btn.textContent = "Sent";
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.includes("clientIsNotInGmMode")) {
      status(`"${result.title}": slabs can only be placed by the GM.`, "warn");
    } else if (msg.includes("notInBoard")) {
      status(`"${result.title}": open a board first.`, "warn");
    } else if (msg.includes("dataOversized")) {
      status(`"${result.title}": slab exceeds TaleSpire's size limit.`, "warn");
    } else {
      status(`Failed to send "${result.title}": ${msg}`, "warn");
    }
    btn.textContent = original;
    btn.disabled = false;
  }
}

$("search").addEventListener("click", onSearch);
$("search-form").addEventListener("submit", onSearch);
