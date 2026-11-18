import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `npm run build` produces dist/index.html: a single self-contained file
// that can be opened directly from disk or hosted anywhere.
export default defineConfig({
  base: "./",
  plugins: [viteSingleFile()],
});
