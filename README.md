# TaleSpire Board Gen

A TaleSpire Symbiote for working with slabs. First feature: search Talestavern and send slabs directly to the GM's hand.

**Status:** v0.2 — Search + Restyle shipped. Procedural generation still to come.

## Features

### 1. Talestavern search (shipped)
- Type a query; the Symbiote scrapes `talestavern.com/?s=<q>&post_type=slab`.
- Click **Send to hand** on a result; the slab string is fetched from its page and handed to TaleSpire via `TS.slabs.sendSlabToHand`.
- GM only (TaleSpire gates slab placement).

### 2. Restyle (shipped)
- Paste a slab (TaleSpire Ctrl+C output, or from Talestavern, or anywhere else) and click **Analyze**.
- Each unique asset kind in the slab is listed with its name, thumbnail, and placement count.
- For any row, type in the "replace with" field — installed tiles and props from your content packs appear as suggestions (format: `name · pack [shortId]`).
- Click **Send restyled slab**: matching UUIDs are overwritten in the binary, the slab is repacked via `TS.slabs.pack`, and handed to you.
- **Caveat:** the swap preserves coords and rotation, not footprint. If the replacement tile has a different `colliderBoundsBound` than the original, geometry will misalign.

### 3. Procedural generation (planned)
Dungeon / cave generators produce a slab from scratch.

## Files

- `manifest.json` — Symbiote metadata
- `index.html` — search UI
- `symbiote.js` — search/fetch/send logic

## Local dev

```sh
python3 -m http.server 8080
```

Add `http://localhost:8080` as a custom Symbiote URL in TaleSpire. Note that outside of TaleSpire the panel renders but **Send to hand** will fail since `TS.*` isn't defined.

## Hosting via GitHub Pages

Push to `main`, enable Pages on `main` / root. Symbiote URL: `https://<user>.github.io/boardgen-talespire/`.

When updating `symbiote.js`, bump the `?v=N` query in `index.html` so browsers re-fetch.

## API notes

- Docs: `symbiote-docs.talespire.com/api_doc_v0_1.md.html`
- Slab format: `github.com/Bouncyrock/DumbSlabStats/blob/master/format.md`
- Talestavern has no REST API; search is HTML-scraped. CORS is open (`access-control-allow-origin: *`) so direct `fetch` works with no proxy.
