// MapLibre v6 starts its web worker from a URL next to its own module, which bundling breaks.
// Serve the (self-contained) worker from /vendor and point MapLibre at it with setWorkerUrl().
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = createRequire(import.meta.url).resolve('maplibre-gl/package.json');
const out = join(here, '..', 'public', 'vendor');
mkdirSync(out, { recursive: true });
copyFileSync(
  join(dirname(pkg), 'dist', 'maplibre-gl-worker.mjs'),
  join(out, 'maplibre-gl-worker.mjs'),
);
