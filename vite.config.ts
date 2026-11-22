import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `npm run build` produces dist/index.html: a single self-contained file
// that can be opened directly from disk or hosted anywhere. The files in public/
// (manifest, service worker, icons) only make the hosted site installable (PWA);
// the game never needs them.
export default defineConfig({
  base: "./",
  plugins: [viteSingleFile()],
});
