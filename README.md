# TaleSpire Board Gen

A TaleSpire Symbiote for procedurally generating boards (dungeons, caves, etc.) and placing tiles via the Symbiote API.

**Status:** skeleton. The grid-generation side works; the TaleSpire tile-placement API is not yet wired up.

## Planned generators

- `dungeon` — rooms connected by L-shaped corridors (stub exists).
- _future:_ caves (cellular automata), towns, overworld.

## Files

- `manifest.json` — Symbiote metadata
- `index.html` — parameter panel
- `symbiote.js` — seeded RNG, generators, placement stub

## Local dev

```sh
python3 -m http.server 8080
```

Then add `http://localhost:8080` as a custom Symbiote URL in TaleSpire.

## Hosting via GitHub Pages

Push and enable Pages on `main` / root. Symbiote URL: `https://<user>.github.io/boardgen-talespire/`.

Bump the `?v=N` query string in `index.html` when pushing a new `symbiote.js` so browsers re-fetch.

## Next steps

1. Confirm the TaleSpire Symbiote tile-placement API (method name, accepted tile IDs, coord system).
2. Map generator output (2D `0/1` grid) to concrete tile content-pack UUIDs.
3. Replace the `placeTiles` stub in `symbiote.js`.
