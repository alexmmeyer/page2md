import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync, existsSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const extRoot = join(repoRoot, "extension");
const dist = join(extRoot, "dist");
const src = join(extRoot, "src");

if (!existsSync(dist)) {
  mkdirSync(dist, { recursive: true });
}

await esbuild.build({
  entryPoints: [join(src, "popup.ts")],
  bundle: true,
  outfile: join(dist, "popup.js"),
  format: "iife",
  platform: "browser",
  // keepNames injects __name() calls inside bundled functions; those break
  // chrome.scripting.executeScript(func) because the injected copy runs in the
  // page world where __name does not exist.
  keepNames: false,
  alias: {
    "@": join(repoRoot, "src"),
  },
});

for (const file of ["popup.html", "popup.css"]) {
  copyFileSync(join(src, file), join(dist, file));
}
copyFileSync(join(extRoot, "manifest.json"), join(dist, "manifest.json"));

const iconsSrc = join(extRoot, "icons");
const iconsDist = join(dist, "icons");
if (existsSync(iconsSrc)) {
  cpSync(iconsSrc, iconsDist, { recursive: true });
}

console.log("extension/dist ready — load unpacked from extension/dist");
