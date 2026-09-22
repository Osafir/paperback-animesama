# Anime-Sama for Paperback 0.8

Direct, client-side Anime-Sama scan source for Paperback **0.8.x**. It supports
catalogue search, metadata, scan variants (VF/VA when offered), chapters and
page URLs without a proxy or third-party API.

## Development

```sh
npm ci
npm run typecheck
npm run smoke
npm run bundle
```

`npm run bundle` writes the installable Paperback 0.8 repository to `bundles/`:
`index.html`, `versioning.json`, and `AnimeSama/source.js`.

## Structure

- `src/AnimeSama/AnimeSama.ts` — Paperback 0.8 source and HTTP integration
- `src/AnimeSama/Parser.ts` — resilient Anime-Sama HTML/script parsing
- `src/AnimeSama/Constants.ts` — central site configuration
- `scripts/smoke.ts` — live, non-destructive integration smoke tests

## Installation

After publishing `bundles/` through GitHub Pages, add that Pages URL as a source
repository in Paperback 0.8, then install **Anime-Sama**. The CI workflow deploys
this directory once GitHub Pages is enabled for the repository.

## Notes

This project is independently implemented. The current site behaviour was
researched against Anime-Sama and the Apache-2.0 licensed Keiyoushi Anime-Sama
extension; no Kotlin source is bundled or reused.

