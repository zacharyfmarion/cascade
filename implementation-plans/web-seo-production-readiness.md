# Web SEO Production Readiness

## Goal

Make `https://cascade-editor.pages.dev/` production-ready for SEO by improving metadata quality, adding crawler-facing assets, and ensuring the page exposes meaningful indexable content before JavaScript boots.

## Approach

Upgrade the web app's static HTML with stronger title/description/canonical/Open Graph/Twitter metadata, add `SoftwareApplication` structured data, and provide a semantic fallback shell inside `#root` so crawlers get descriptive content even if they do not execute the full app. Ship the missing public assets (`robots.txt`, `sitemap.xml`, web manifest, social preview image, manifest icons) and add a focused regression test that validates the SEO surface directly from checked-in files.

## Affected Areas

- `apps/web/index.html`
- `apps/web/public/`
- `apps/web/src/__tests__/`

## Checklist

- [x] Inspect the current live and local SEO surface
- [x] Upgrade static metadata and semantic fallback content
- [x] Add crawler assets and share-preview assets
- [x] Add regression coverage for SEO files
- [x] Run frontend validation
- [ ] Prepare git handoff and PR summary
