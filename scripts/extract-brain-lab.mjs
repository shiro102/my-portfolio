import fs from "fs";
import path from "path";
import { svgPathBbox } from "svg-path-bbox";

const ROOT = path.resolve("src/components/2D");
const SOURCE = path.join(ROOT, "components/Brain.tsx");
const OUT_DIR = path.join(ROOT, "assets/brain");

const ROTATE_MAP = {
  rotatesForward1: { peakDeg: 360, direction: 1, duration: 6, mode: "spin-center" },
  rotatesForward2: { peakDeg: 180, direction: 1, duration: 4, mode: "spin-center" },
  rotatesForward3: { peakDeg: 90, direction: 1, duration: 3, mode: "spin-center" },
  rotatesForward4: { peakDeg: 45, direction: 1, duration: 2.5, mode: "spin-center" },
  rotatesBackward1: { peakDeg: 360, direction: -1, duration: 6, mode: "spin-center" },
  rotatesBackward2: { peakDeg: 180, direction: -1, duration: 4, mode: "spin-center" },
  rotatesBackward3: { peakDeg: 90, direction: -1, duration: 3, mode: "spin-center" },
  rotatesBackward4: { peakDeg: 45, direction: -1, duration: 2.5, mode: "spin-center" },
};

const SKIP_TAGS = new Set(["defs", "style", "title", "desc", "clippath", "mask", "filter"]);
const SHAPE_TAGS = new Set(["path", "polygon", "rect", "circle", "ellipse"]);
const GENERIC_IDS = /^(page-1|artboard|brain|rs|ls|group-\d+)$/i;
const PART_ID = /^(rs|ls|main)-/i;

function identity() {
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

function scaleMatrix(sx, sy = sx) {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

function parseTransform(transformStr) {
  if (!transformStr) return identity();
  let m = identity();
  const re = /(matrix|translate|rotate|scale)\s*\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(transformStr))) {
    const params = match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    let step = identity();
    switch (match[1]) {
      case "translate":
        step = translateMatrix(params[0], params[1] ?? 0);
        break;
      case "rotate":
        step = rotateMatrix(params[0], params[1] ?? 0, params[2] ?? 0);
        break;
      case "scale":
        step = scaleMatrix(params[0], params[1] ?? params[0]);
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

function isIdentity(m) {
  return (
    Math.abs(m.a - 1) < 1e-9 &&
    Math.abs(m.b) < 1e-9 &&
    Math.abs(m.c) < 1e-9 &&
    Math.abs(m.d - 1) < 1e-9 &&
    Math.abs(m.e) < 1e-9 &&
    Math.abs(m.f) < 1e-9
  );
}

function matrixAttr(m) {
  if (isIdentity(m)) return undefined;
  const fmt = (n) => {
    const v = Math.abs(n) < 1e-9 ? 0 : n;
    return Number(v.toFixed(4));
  };
  return `matrix(${fmt(m.a)} ${fmt(m.b)} ${fmt(m.c)} ${fmt(m.d)} ${fmt(m.e)} ${fmt(m.f)})`;
}

function applyMatrix(m, x, y) {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

function kebab(id) {
  return String(id)
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function extractSvg(source) {
  const start = source.indexOf("<svg");
  const end = source.lastIndexOf("</svg>");
  if (start < 0 || end < 0) throw new Error("No <svg> found in Brain.tsx");
  return source.slice(start, end + "</svg>".length);
}

function stripJsxComments(svg) {
  return svg
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, "");
}

function readQuoted(str, start) {
  const quote = str[start];
  let i = start + 1;
  let out = "";
  while (i < str.length) {
    const ch = str[i];
    if (ch === "\\") {
      out += str[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (ch === quote) return { value: out, end: i + 1 };
    out += ch;
    i += 1;
  }
  return { value: out, end: str.length };
}

function readJsxExpr(str, start) {
  let i = start;
  if (str[i] !== "{") return { value: "", end: start };
  let depth = 0;
  const from = i;
  while (i < str.length) {
    const ch = str[i];
    if (ch === '"' || ch === "'") {
      const quoted = readQuoted(str, i);
      i = quoted.end;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return { value: str.slice(from, i + 1), end: i + 1 };
    }
    i += 1;
  }
  return { value: str.slice(from), end: str.length };
}

function parseAttrs(raw) {
  const attrs = {};
  let i = 0;
  while (i < raw.length) {
    while (i < raw.length && /\s/.test(raw[i])) i += 1;
    if (i >= raw.length) break;
    const nameMatch = raw.slice(i).match(/^([A-Za-z_:][\w:.-]*)/);
    if (!nameMatch) {
      i += 1;
      continue;
    }
    const name = nameMatch[1];
    i += name.length;
    while (i < raw.length && /\s/.test(raw[i])) i += 1;
    if (raw[i] !== "=") {
      attrs[name] = "true";
      continue;
    }
    i += 1;
    while (i < raw.length && /\s/.test(raw[i])) i += 1;
    if (raw[i] === '"' || raw[i] === "'") {
      const quoted = readQuoted(raw, i);
      attrs[name] = quoted.value;
      i = quoted.end;
    } else if (raw[i] === "{") {
      const expr = readJsxExpr(raw, i);
      attrs[name] = expr.value;
      i = expr.end;
    } else {
      const m = raw.slice(i).match(/^[^\s>]+/);
      attrs[name] = m ? m[0] : "";
      i += attrs[name].length;
    }
  }
  return attrs;
}

function normalizeAttrName(name) {
  if (name === "strokeWidth") return "stroke-width";
  if (name === "fillRule") return "fill-rule";
  if (name === "className") return "class";
  if (name === "clipPath") return "clip-path";
  return name;
}

function parseRotateKey(styleValue) {
  if (!styleValue) return null;
  const m = String(styleValue).match(/rotates(?:Forward|Backward)[1-4]/);
  return m ? m[0] : null;
}

function nextTag(svg, from) {
  const start = svg.indexOf("<", from);
  if (start < 0) return null;
  if (svg.startsWith("<!--", start)) {
    const end = svg.indexOf("-->", start + 4);
    return { kind: "comment", start, end: end < 0 ? svg.length : end + 3 };
  }
  let i = start + 1;
  const closing = svg[i] === "/";
  if (closing) i += 1;
  const nameMatch = svg.slice(i).match(/^[A-Za-z][\w:.-]*/);
  if (!nameMatch) {
    return { kind: "text", start, end: start + 1 };
  }
  const rawName = nameMatch[0];
  i += rawName.length;
  let depthBrace = 0;
  let quote = null;
  while (i < svg.length) {
    const ch = svg[i];
    if (quote) {
      if (ch === "\\" && (quote === '"' || quote === "'")) {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === "{") {
      depthBrace += 1;
      i += 1;
      continue;
    }
    if (ch === "}" && depthBrace) {
      depthBrace -= 1;
      i += 1;
      continue;
    }
    if (depthBrace) {
      i += 1;
      continue;
    }
    if (ch === ">") {
      const selfClosing = svg[i - 1] === "/";
      const attrRaw = svg.slice(start + 1 + (closing ? 1 : 0) + rawName.length, selfClosing ? i - 1 : i);
      return {
        kind: closing ? "close" : "open",
        name: rawName.replace(/^motion\./, "").toLowerCase(),
        rawName,
        attrs: closing ? {} : parseAttrs(attrRaw),
        selfClosing,
        start,
        end: i + 1,
      };
    }
    i += 1;
  }
  return { kind: "text", start, end: svg.length };
}

function paintKey(fill, stroke, strokeWidth, fillRule) {
  return JSON.stringify({
    fill: fill ?? "",
    stroke: stroke ?? "",
    strokeWidth: strokeWidth ?? "",
    fillRule: fillRule ?? "",
  });
}

function localBounds(attrs) {
  if (attrs.d) {
    try {
      const [minX, minY, maxX, maxY] = svgPathBbox(attrs.d);
      if ([minX, minY, maxX, maxY].some((n) => !Number.isFinite(n))) return null;
      return { minX, minY, maxX, maxY };
    } catch {
      return null;
    }
  }
  if (attrs.points) {
    const nums = attrs.points
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => Number.isFinite(n));
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
  if (attrs.cx != null && attrs.cy != null) {
    const cx = Number(attrs.cx);
    const cy = Number(attrs.cy);
    const rx = Number(attrs.rx ?? attrs.r ?? 0);
    const ry = Number(attrs.ry ?? attrs.r ?? 0);
    return { minX: cx - rx, minY: cy - ry, maxX: cx + rx, maxY: cy + ry };
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

function shapeBounds(attrs, matrix) {
  const local = localBounds(attrs);
  if (!local) return { x: 0, y: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const corners = [
    { x: local.minX, y: local.minY },
    { x: local.maxX, y: local.minY },
    { x: local.minX, y: local.maxY },
    { x: local.maxX, y: local.maxY },
  ].map((point) => applyMatrix(matrix, point.x, point.y));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
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

function groupNameFor(stack, pathId) {
  if (pathId && PART_ID.test(pathId)) return kebab(pathId);
  const ids = stack.map((frame) => frame.id).filter(Boolean);
  const specific = [...ids].reverse().find((id) => PART_ID.test(id));
  const inner = ids[ids.length - 1];
  if (inner && specific && kebab(inner) !== kebab(specific) && GENERIC_IDS.test(inner)) {
    return `${kebab(specific)}-${kebab(inner)}`;
  }
  if (specific) return kebab(specific);
  if (inner && !GENERIC_IDS.test(inner)) return kebab(inner);
  return "ungrouped";
}

function extract() {
  const source = fs.readFileSync(SOURCE, "utf8");
  const svg = stripJsxComments(extractSvg(source));
  const stack = [
    {
      id: null,
      matrix: identity(),
      fill: undefined,
      stroke: undefined,
      strokeWidth: undefined,
      fillRule: undefined,
    },
  ];
  const shapes = [];
  const groupIds = [];
  const groupMotion = {};
  const classByKey = new Map();
  let skipDepth = 0;
  let i = 0;

  const inheritPaint = (parent, attrs) => {
    const fill = attrs.fill ?? parent.fill;
    const stroke = attrs.stroke ?? parent.stroke;
    const strokeWidth = attrs["stroke-width"] ?? parent.strokeWidth;
    const fillRule = attrs["fill-rule"] ?? parent.fillRule;
    return { fill, stroke, strokeWidth, fillRule };
  };

  while (i < svg.length) {
    const tag = nextTag(svg, i);
    if (!tag) break;
    if (tag.kind === "comment") {
      i = tag.end;
      continue;
    }
    if (tag.kind === "text") {
      i = tag.end;
      continue;
    }

    const normalized = {};
    for (const [key, value] of Object.entries(tag.attrs)) {
      normalized[normalizeAttrName(key)] = value;
    }

    if (tag.kind === "close") {
      if (skipDepth > 0) {
        skipDepth -= 1;
        i = tag.end;
        continue;
      }
      if (stack.length > 1) stack.pop();
      i = tag.end;
      continue;
    }

    if (skipDepth > 0) {
      if (!tag.selfClosing) skipDepth += 1;
      i = tag.end;
      continue;
    }

    if (SKIP_TAGS.has(tag.name)) {
      if (!tag.selfClosing) skipDepth += 1;
      i = tag.end;
      continue;
    }

    const parent = stack[stack.length - 1];
    const paint = inheritPaint(parent, normalized);
    const localMatrix = parseTransform(normalized.transform);
    const matrix = multiply(parent.matrix, localMatrix);
    const rotateKey = parseRotateKey(normalized.style);

    if (SHAPE_TAGS.has(tag.name)) {
      const d = normalized.d;
      const points = normalized.points;
      if (tag.name === "path" && !d) {
        i = tag.end;
        continue;
      }
      const bounds = shapeBounds(normalized, matrix);
      const key = paintKey(paint.fill, paint.stroke, paint.strokeWidth, paint.fillRule);
      let className = classByKey.get(key);
      if (!className) {
        className = `brain-${classByKey.size}`;
        classByKey.set(key, className);
      }
      const pathId = normalized.id;
      let group = groupNameFor(stack, pathId);
      if (rotateKey && ROTATE_MAP[rotateKey]) {
        const nextMotion = ROTATE_MAP[rotateKey];
        const existing = groupMotion[group];
        if (
          existing &&
          (existing.peakDeg !== nextMotion.peakDeg || existing.direction !== nextMotion.direction)
        ) {
          group = `${group}-${kebab(rotateKey)}`;
        }
        groupMotion[group] = { ...nextMotion };
      }
      if (!groupIds.includes(group)) groupIds.push(group);
      const id = `path-${shapes.length}`;
      const transform = matrixAttr(matrix);
      shapes.push({
        id,
        tag: tag.name === "circle" || tag.name === "ellipse" ? "path" : tag.name,
        className,
        x: bounds.x,
        y: bounds.y,
        attrs: {
          d,
          points,
          x: normalized.x,
          y: normalized.y,
          width: normalized.width,
          height: normalized.height,
          transform,
          fillRule: paint.fillRule,
        },
        group,
        _bounds: bounds,
      });
      if (!tag.selfClosing) skipDepth += 1;
      i = tag.end;
      continue;
    }

    if (!tag.selfClosing) {
      stack.push({
        id: normalized.id ?? parent.id,
        matrix,
        fill: paint.fill,
        stroke: paint.stroke,
        strokeWidth: paint.strokeWidth,
        fillRule: paint.fillRule,
      });
    }
    i = tag.end;
  }

  if (!shapes.length) throw new Error("No shapes extracted from Brain.tsx");

  const groups = {};
  for (const name of groupIds) groups[name] = [];
  for (const shape of shapes) groups[shape.group].push(shape.id);

  const xs = shapes.flatMap((s) => [s._bounds.minX, s._bounds.maxX]);
  const ys = shapes.flatMap((s) => [s._bounds.minY, s._bounds.maxY]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const pad = 24;
  const viewBox = `${Math.floor(minX - pad)} ${Math.floor(minY - pad)} ${Math.ceil(maxX - minX + pad * 2)} ${Math.ceil(maxY - minY + pad * 2)}`;

  const styleCss = [...classByKey.entries()]
    .map(([key, className]) => {
      const paint = JSON.parse(key);
      const rules = [];
      if (paint.fill) rules.push(`fill: ${paint.fill}`);
      else rules.push("fill: none");
      if (paint.stroke) rules.push(`stroke: ${paint.stroke}`);
      if (paint.strokeWidth) rules.push(`stroke-width: ${paint.strokeWidth}`);
      if (paint.fillRule) rules.push(`fill-rule: ${paint.fillRule}`);
      return `.${className} { ${rules.join("; ")}; }`;
    })
    .join("\n");

  const document = {
    viewBox,
    styleCss,
    shapes: shapes.map(({ id, tag, className, x, y, attrs }) => ({
      id,
      tag,
      className,
      x,
      y,
      attrs: Object.fromEntries(
        Object.entries(attrs).filter(([, value]) => value != null && value !== "")
      ),
    })),
  };

  const groupOrder = Object.fromEntries(groupIds.map((name, index) => [name, index]));
  const session = {
    groupOrder,
    splits: {},
    pivots: {},
    motion: groupMotion,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "paths.json"), `${JSON.stringify(document, null, 2)}\n`);
  fs.writeFileSync(
    path.join(OUT_DIR, "path-groups.json"),
    `${JSON.stringify({ viewBox, groups }, null, 2)}\n`
  );
  fs.writeFileSync(path.join(OUT_DIR, "lab-session.json"), `${JSON.stringify(session, null, 2)}\n`);

  const animated = Object.keys(groupMotion).length;
  console.log(
    `Brain lab extract: ${shapes.length} paths, ${groupIds.length} groups, ${animated} animated, viewBox="${viewBox}"`
  );
}

extract();
