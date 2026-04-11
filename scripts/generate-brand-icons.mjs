/**
 * Renders white "{#}" on #000 using IBM Plex Sans Bold via Playwright + Google Fonts.
 * Run: node scripts/generate-brand-icons.mjs (requires network for fonts)
 */
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

function htmlForSize(px) {
  // Larger fraction of the canvas so {#} reads at 16px toolbar size.
  const fontSize = Math.max(9, Math.round(px * 0.54));
  const letterSpacing = Math.round(px * -0.028);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@700&display=block" rel="stylesheet" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #000000; }
    #mark {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #000000;
      color: #ffffff;
      font-family: "IBM Plex Sans", system-ui, sans-serif;
      font-weight: 700;
      font-size: ${fontSize}px;
      line-height: 1;
      letter-spacing: ${letterSpacing}px;
      -webkit-font-smoothing: antialiased;
    }
  </style>
</head>
<body><div id="mark">{#}</div></body>
</html>`;
}

async function renderIcon(browser, sizePx, outPath) {
  const page = await browser.newPage({
    viewport: { width: sizePx, height: sizePx },
    deviceScaleFactor: 1,
  });
  await page.setContent(htmlForSize(sizePx), { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.screenshot({
    path: outPath,
    clip: { x: 0, y: 0, width: sizePx, height: sizePx },
    type: "png",
  });
  await page.close();
}

const extIconsDir = join(repoRoot, "extension", "icons");
const appDir = join(repoRoot, "src", "app");

mkdirSync(extIconsDir, { recursive: true });
mkdirSync(appDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

try {
  await renderIcon(browser, 32, join(appDir, "icon.png"));
  await renderIcon(browser, 180, join(appDir, "apple-icon.png"));

  for (const s of [16, 32, 48, 128]) {
    await renderIcon(browser, s, join(extIconsDir, `icon-${s}.png`));
  }
} finally {
  await browser.close();
}

console.log("Wrote src/app/icon.png, src/app/apple-icon.png, extension/icons/icon-*.png");
