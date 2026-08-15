import fs from "fs";
import path from "path";
import { svgPathBbox } from "svg-path-bbox";

const svgPath = "Sample game design/Hoshino_vector1.svg";
const outDir = "src/components/2D/assets/hoshino";
const svg = fs.readFileSync(svgPath, "utf8");

const defsMatch = svg.match(/<defs>([\s\S]*?)<\/defs>/);
const styleMatch = defsMatch?.[1]?.match(/<style>([\s\S]*?)<\/style>/);
const styleCss = styleMatch ? styleMatch[1].trim() : "";

const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 2048 2048";
const generativeMatch = svg.match(/<g id="Generative_Object">([\s\S]*?)<\/g>\s*<\/svg>/);
let art = generativeMatch ? generativeMatch[1] : "";
art = art.replace(/<rect class="st865" width="2048" height="2048"\/>/, "");

const shapeRe = /<(path|polygon|rect)\b([^>]*?)\/?>/g;

function parseAttrs(raw) {
  const attrs = {};
  const attrRe = /(\w+)="([^"]*)"/g;
  let m;
  while ((m = attrRe.exec(raw)) !== null) attrs[m[1]] = m[2];
  return attrs;
}

function identityMatrix() {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

function multiply(m1, m2) {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

function translateMatrix(tx, ty = 0) {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

function rotateMatrix(deg, cx = 0, cy = 0) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const t1 = translateMatrix(cx, cy);
  const r = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
  const t2 = translateMatrix(-cx, -cy);
  return multiply(multiply(t1, r), t2);
}

function applyMatrix(m, x, y) {
  return {
    x: m.a * x + m.c * y + m.e,
    y: m.b * x + m.d * y + m.f,
  };
}

function parseTransformMatrix(transformStr) {
  if (!transformStr) return identityMatrix();
  let m = identityMatrix();
  const re = /(matrix|translate|rotate|scale)\s*\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(transformStr))) {
    const params = match[2].trim().split(/[\s,]+/).map(Number);
    let step = identityMatrix();
    switch (match[1]) {
      case "translate":
        step = translateMatrix(params[0], params[1] ?? 0);
        break;
      case "rotate":
        step = rotateMatrix(params[0], params[1] ?? 0, params[2] ?? 0);
        break;
      case "scale":
        step = { a: params[0], b: 0, c: 0, d: params[1] ?? params[0], e: 0, f: 0 };
        break;
      case "matrix":
        step = {
          a: params[0],
          b: params[1],
          c: params[2],
          d: params[3],
          e: params[4],
          f: params[5],
        };
        break;
      default:
        break;
    }
    m = multiply(m, step);
  }
  return m;
}

function localBounds(attrs) {
  if (attrs.d) {
    const [minX, minY, maxX, maxY] = svgPathBbox(attrs.d);
    return { minX, minY, maxX, maxY };
  }
  if (attrs.points) {
    const nums = attrs.points
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => !Number.isNaN(n));
    const xs = [];
    const ys = [];
    for (let i = 0; i < nums.length - 1; i += 2) {
      xs.push(nums[i]);
      ys.push(nums[i + 1]);
    }
    if (!xs.length) return null;
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
  }
  if (attrs.x != null && attrs.y != null) {
    const minX = Number(attrs.x);
    const minY = Number(attrs.y);
    return {
      minX,
      minY,
      maxX: minX + Number(attrs.width ?? 0),
      maxY: minY + Number(attrs.height ?? 0),
    };
  }
  return null;
}

function shapeBounds(attrs) {
  const local = localBounds(attrs);
  if (!local) return { x: 0, y: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 };

  const corners = [
    { x: local.minX, y: local.minY },
    { x: local.maxX, y: local.minY },
    { x: local.minX, y: local.maxY },
    { x: local.maxX, y: local.maxY },
  ];
  const matrix = parseTransformMatrix(attrs.transform);
  const transformed = corners.map((point) => applyMatrix(matrix, point.x, point.y));
  const xs = transformed.map((point) => point.x);
  const ys = transformed.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    minX,
    minY,
    maxX,
    maxY,
    x: Math.round((minX + maxX) / 2),
    y: Math.round((minY + maxY) / 2),
  };
}

const shapes = [];
let match;
while ((match = shapeRe.exec(art)) !== null) {
  const tag = match[1];
  const attrs = parseAttrs(match[2]);
  const id = `path-${shapes.length}`;
  const bounds = shapeBounds(attrs);
  shapes.push({
    id,
    tag,
    className: attrs.class ?? "",
    x: bounds.x,
    y: bounds.y,
    attrs: {
      d: attrs.d,
      points: attrs.points,
      x: attrs.x,
      y: attrs.y,
      width: attrs.width,
      height: attrs.height,
      transform: attrs.transform,
    },
  });
}

fs.mkdirSync(outDir, { recursive: true });

const manifest = shapes.map(({ id, tag, className, x, y }) => ({
  id,
  tag,
  className,
  x,
  y,
}));

fs.writeFileSync(path.join(outDir, "path-manifest.json"), JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(outDir, "paths.json"), JSON.stringify({ viewBox, styleCss, shapes }, null, 2));

const groupsFile = path.join(outDir, "path-groups.json");
if (!fs.existsSync(groupsFile)) {
  const template = {
    viewBox,
    groups: {
      hat: [],
      head: [],
      hair: [],
      torso: [],
      "arm-left": [],
      "arm-right": [],
      skirt: [],
      "leg-left": [],
      "leg-right": [],
      detail: [],
    },
  };
  fs.writeFileSync(groupsFile, JSON.stringify(template, null, 2));
}

console.log(`Indexed ${shapes.length} shapes → ${outDir}/path-manifest.json`);
