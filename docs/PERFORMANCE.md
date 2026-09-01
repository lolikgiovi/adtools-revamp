# Performance baseline

Use the production build as the repeatable baseline:

```bash
npm run build
du -sh dist
find dist/assets -type f -maxdepth 1 -print0 | xargs -0 ls -lS | head -20
```

Record total `dist` size and the largest assets before and after performance work. In the browser, compare first-load transferred bytes and the time until the selected tool is interactive with cache disabled.

Heavy tools are lazy-loaded and kept warm briefly. Verify Quick Query, Compare Config, and Run Query by opening each, switching tools, returning, and confirming editor state and layout are preserved; after the warm-cache timeout, confirm their workers and editors are released.
