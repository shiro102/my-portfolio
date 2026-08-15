import fs from "fs";
import path from "path";

const svg = fs.readFileSync("Sample game design/hoshino.svg", "utf8");
const outDir = "src/components/2D/assets/hoshino";
fs.mkdirSync(outDir, { recursive: true });

const defsMatch = svg.match(/<defs>([\s\S]*?)<\/defs>/);
const defs = defsMatch ? defsMatch[1] : "";

const svgOpen = svg.match(/^<svg[^>]*>/)?.[0] ?? "";
const viewBox = svgOpen.match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 810 1440";

const clipBounds = {};
const clipRe = /clipPath id="([^"]+)"[^>]*><path d="([^"]+)"/g;
let m;
while ((m = clipRe.exec(defs)) !== null) {
  const nums = m[2].match(/[\d.]+/g).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  clipBounds[m[1]] = {
    yMin: Math.min(...ys),
    yMax: Math.max(...ys),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function layerName(clipId) {
  const b = clipBounds[clipId];
  if (!b) return clipId;
  if (b.yMax < 450 && b.height < 80) return "hat-rim";
  if (b.yMax < 450) return "head-upper";
  if (b.yMin > 1000 && b.height < 20) return "detail";
  if (b.yMin > 1000) return "lower-body";
  if (b.height > 700) return "body-main";
  return "misc";
}

const afterDefs = svg.replace(/<defs>[\s\S]*?<\/defs>/, "");
const groupRe = /<g clip-path="url\(#([^)]+)\)">([\s\S]*?)<\/g>/g;

const layers = [];
while ((m = groupRe.exec(afterDefs)) !== null) {
  const clipId = m[1];
  const content = m[2].trim();
  const base = layerName(clipId);
  const count = layers.filter((l) => l.name.startsWith(base)).length;
  const name = count ? `${base}-${count + 1}` : base;
  layers.push({ clipId, name, content });
}

// Write individual layer SVGs (path only, full viewBox)
for (const layer of layers) {
  const file = path.join(outDir, `${layer.name}.svg`);
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">
<defs>${defs}</defs>
<g clip-path="url(#${layer.clipId})">${layer.content}</g>
</svg>`;
  fs.writeFileSync(file, body);
}

// Write manifest
const manifest = {
  viewBox,
  layers: layers.map((l) => ({
    id: l.name,
    clipId: l.clipId,
    file: `${l.name}.svg`,
    bounds: clipBounds[l.clipId],
  })),
};
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

// Write combined animatable snippet paths only
const partsTs = `// Auto-generated from hoshino.svg — ${layers.length} clip layers (not true body-part rig)
export const HOSHINO_VIEWBOX = "${viewBox}";

export const hoshinoLayers = ${JSON.stringify(
  layers.map((l) => ({ id: l.name, clipId: l.clipId, bounds: clipBounds[l.clipId] })),
  null,
  2
)} as const;

export type HoshinoLayerId = typeof hoshinoLayers[number]["id"];
`;
fs.writeFileSync(path.join(outDir, "layers.ts"), partsTs);

console.log(`Extracted ${layers.length} layers to ${outDir}`);
layers.forEach((l) => console.log(" -", l.name, l.clipId));
