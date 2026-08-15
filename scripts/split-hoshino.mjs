import fs from "fs";

const svg = fs.readFileSync("Sample game design/hoshino.svg", "utf8");

// Extract defs block
const defsMatch = svg.match(/<defs>([\s\S]*?)<\/defs>/);
const defs = defsMatch ? defsMatch[1] : "";

// Extract groups after defs
const afterDefs = svg.replace(/<defs>[\s\S]*?<\/defs>/, "");
const groupRe = /<g clip-path="url\(#([^)]+)\)">([\s\S]*?)<\/g>/g;

const groups = [];
let m;
while ((m = groupRe.exec(afterDefs)) !== null) {
  const content = m[2];
  const pathCount = (content.match(/<path /g) || []).length;
  const pathDs = [...content.matchAll(/d="([^"]{0,80})/g)].map((x) => x[1]);
  groups.push({ clipId: m[1], pathCount, samplePaths: pathDs.slice(0, 2) });
}

console.log("Groups found:", groups.length);
groups.forEach((g) => console.log(g));

// Parse clip bounds
const clipBounds = {};
const clipRe = /clipPath id="([^"]+)"[^>]*><path d="([^"]+)"/g;
while ((m = clipRe.exec(defs)) !== null) {
  const nums = m[2].match(/[\d.]+/g).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  clipBounds[m[1]] = {
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
    yMin: Math.min(...ys),
    yMax: Math.max(...ys),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

console.log("\nSuggested layer names by Y position:");
const sorted = groups
  .map((g) => ({ ...g, bounds: clipBounds[g.clipId] }))
  .sort((a, b) => a.bounds.yMin - b.bounds.yMin || a.bounds.height - b.bounds.height);

sorted.forEach((g) => {
  const b = g.bounds;
  let name = "unknown";
  if (b.yMax < 450 && b.height < 80) name = "hat-band";
  else if (b.yMax < 450) name = "head-hair-upper";
  else if (b.yMin > 1000 && b.height < 20) name = "detail-sliver";
  else if (b.yMin > 1000) name = "lower-body-feet";
  else if (b.height > 700) name = "full-body-main";
  console.log(`${name.padEnd(18)} clip=${g.clipId} paths=${g.pathCount} y=${b.yMin}-${b.yMax} h=${b.height}`);
});
