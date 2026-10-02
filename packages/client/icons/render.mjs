// Renders the app's PNG icons from the SVGs, in headless Chromium:
//   node packages/client/icons/render.mjs   (with playwright resolvable)
// The PNGs are committed; run this again only when an SVG changes.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, "..", "public");
const jobs = [
  [join(pub, "favicon.svg"), 192, "icon-192.png"],
  [join(pub, "favicon.svg"), 512, "icon-512.png"],
  [join(here, "maskable.svg"), 512, "maskable-512.png"],
  // iOS draws its own rounded corners and fills transparency with black.
  [join(here, "maskable.svg"), 180, "apple-touch-icon.png"],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [svg, size, out] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  const markup = readFileSync(svg, "utf8").replace(
    "<svg ",
    `<svg width="${size}" height="${size}" `,
  );
  await page.setContent(`<body style="margin:0;background:transparent">${markup}</body>`);
  await page.locator("svg").screenshot({ path: join(pub, "icons", out), omitBackground: true });
}
await browser.close();
