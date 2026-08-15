import { svgPathBbox } from "svg-path-bbox";
import defaultGroups from "@/components/2D/assets/hoshino-new/path-groups.json";
import defaultLabSession from "@/components/2D/assets/hoshino-new/lab-session.json";
import defaultPathsData from "@/components/2D/assets/hoshino-new/paths.json";
import brainGroups from "@/components/2D/assets/brain/path-groups.json";
import brainLabSession from "@/components/2D/assets/brain/lab-session.json";
import brainPathsData from "@/components/2D/assets/brain/paths.json";
import {
  HOSHINO_GROUPS_STORAGE_KEY,
  mergeStoredGroupOrders,
  mergeStoredGroups,
} from "@/components/2D/utils/charPathGroups";
import {
  HOSHINO_PIVOTS_STORAGE_KEY,
  type ArmPivotConfig,
} from "@/components/2D/utils/charPathPivots";
import {
  HOSHINO_SPLITS_STORAGE_KEY,
  type PathSplit,
} from "@/components/2D/utils/charPathSplits";
import type { GroupMotionConfig } from "@/components/2D/utils/charGroupMotion";

export const DEFAULT_SVG_ID = "hoshino-new-default";
export const DEFAULT_SVG_NAME = "Hoxilo (built-in)";
export const BRAIN_SVG_ID = "brain-default";
export const BRAIN_SVG_NAME = "Brain (built-in)";
export const LAB_ACTIVE_SVG_KEY = "animation-lab-active-svg";
export const LAB_SVG_LIBRARY_KEY = "animation-lab-svg-library";
export const LAB_SESSIONS_KEY = "animation-lab-sessions";
export const LAB_DEFAULT_SHAPE_OVERRIDES_KEY = "animation-lab-default-shape-overrides";

export type PathShapeAttrs = {
  d?: string;
  points?: string;
  x?: string;
  y?: string;
  width?: string;
  height?: string;
  transform?: string;
  fillRule?: string;
};

export type ShapePaintStroke = {
  d: string;
  color: string;
  /** Pencil fills use the shape CSS class; brush legacy strokes use stroke color. */
  filled?: boolean;
};

export type ShapePaintDot = {
  cx: number;
  cy: number;
  r: number;
  color: string;
};

export type ShapePaintLayers = {
  strokes: ShapePaintStroke[];
  dots: ShapePaintDot[];
};

export type PathShape = {
  id: string;
  tag: string;
  className: string;
  x: number;
  y: number;
  attrs: PathShapeAttrs;
  /** Fill silhouette for stacking; hand-drawn strokes live in paintLayers. */
  silhouetteD?: string;
  paintLayers?: ShapePaintLayers;
};

export type PathDocument = {
  viewBox: string;
  styleCss: string;
  shapes: PathShape[];
};

export type ManifestEntry = {
  id: string;
  tag: string;
  className: string;
  x: number;
  y: number;
};

export type SavedSvg = {
  id: string;
  name: string;
  savedAt: string;
  document: PathDocument;
};

export type MotionDriver = "time" | "scroll";

export function parseMotionDriver(value: unknown, fallback: MotionDriver = "scroll"): MotionDriver {
  return value === "time" || value === "scroll" ? value : fallback;
}

export type LabSession = {
  groups: Record<string, string[]>;
  /** Paint priority per group — higher draws on top; 0 is the minimum. */
  groupOrder?: Record<string, number>;
  splits: Record<string, PathSplit>;
  pivots: ArmPivotConfig;
  motion?: Record<string, GroupMotionConfig>;
  /** How LabSvgCharacter plays motion: time loop vs page scroll. */
  motionDriver?: MotionDriver;
};

export type BuiltinSvg = {
  id: string;
  name: string;
  document: PathDocument;
  groups: Record<string, string[]>;
  session: Omit<LabSession, "groups">;
};

/** Path geometry edits for the built-in SVG. Session storage does not include the document. */
export type DefaultShapeOverride = {
  attrs?: PathShapeAttrs;
  silhouetteD?: string;
  paintLayers?: ShapePaintLayers;
};

const EMPTY_GROUP_TEMPLATE = Object.fromEntries(
  Object.keys(defaultGroups.groups).map((name) => [name, [] as string[]])
) as Record<string, string[]>;

export const BUILTIN_SVGS: BuiltinSvg[] = [
  {
    id: DEFAULT_SVG_ID,
    name: DEFAULT_SVG_NAME,
    document: defaultPathsData as PathDocument,
    groups: defaultGroups.groups as Record<string, string[]>,
    session: {
      groupOrder: defaultLabSession.groupOrder,
      splits: (defaultLabSession.splits ?? {}) as Record<string, PathSplit>,
      pivots: (defaultLabSession.pivots ?? {}) as ArmPivotConfig,
      motion: defaultLabSession.motion as Record<string, GroupMotionConfig>,
      motionDriver: "scroll",
    },
  },
  {
    id: BRAIN_SVG_ID,
    name: BRAIN_SVG_NAME,
    document: brainPathsData as PathDocument,
    groups: brainGroups.groups as Record<string, string[]>,
    session: {
      groupOrder: brainLabSession.groupOrder,
      splits: {},
      pivots: {},
      motion: brainLabSession.motion as Record<string, GroupMotionConfig>,
      motionDriver: "time",
    },
  },
];

export function getBuiltinSvg(svgId: string): BuiltinSvg | undefined {
  return BUILTIN_SVGS.find((entry) => entry.id === svgId);
}

export function isBuiltinSvgId(svgId: string): boolean {
  return BUILTIN_SVGS.some((entry) => entry.id === svgId);
}

const shapeRe = /<(path|polygon|rect)\b([^>]*?)\/?>/g;

function parseAttrs(raw: string) {
  const attrs: Record<string, string> = {};
  const attrRe = /(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(raw)) !== null) attrs[m[1]] = m[2];
  return attrs;
}

function identityMatrix() {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

function multiply(
  m1: { a: number; b: number; c: number; d: number; e: number; f: number },
  m2: { a: number; b: number; c: number; d: number; e: number; f: number }
) {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

function translateMatrix(tx: number, ty = 0) {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

function rotateMatrix(deg: number, cx = 0, cy = 0) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const t1 = translateMatrix(cx, cy);
  const r = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
  const t2 = translateMatrix(-cx, -cy);
  return multiply(multiply(t1, r), t2);
}

function applyMatrix(
  m: { a: number; b: number; c: number; d: number; e: number; f: number },
  x: number,
  y: number
) {
  return {
    x: m.a * x + m.c * y + m.e,
    y: m.b * x + m.d * y + m.f,
  };
}

function parseTransformMatrix(transformStr?: string) {
  if (!transformStr) return identityMatrix();
  let m = identityMatrix();
  const re = /(matrix|translate|rotate|scale)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
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

function localBounds(attrs: PathShapeAttrs) {
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
    const xs: number[] = [];
    const ys: number[] = [];
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

/** Bounding box of path `d` / points / rect in local geometry — ignores `transform`. */
export function getShapeLocalBounds(shape: {
  attrs: PathShapeAttrs;
  silhouetteD?: string;
}): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const d = shape.silhouetteD || shape.attrs.d;
  return localBounds({
    ...shape.attrs,
    ...(d ? { d } : {}),
  });
}

function shapeBounds(attrs: PathShapeAttrs) {
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

function extractArtMarkup(svg: string) {
  const generativeMatch = svg.match(/<g id="Generative_Object">([\s\S]*?)<\/g>\s*<\/svg>/i);
  let art = generativeMatch ? generativeMatch[1] : svg;
  art = art
    .replace(/<defs>[\s\S]*?<\/defs>/i, "")
    .replace(/<\/?svg[^>]*>/gi, "")
    .replace(/<rect class="st865" width="2048" height="2048"\/>/i, "");
  return art;
}

export function manifestFromShapes(shapes: PathShape[]): ManifestEntry[] {
  return shapes.map(({ id, tag, className, x, y }) => ({ id, tag, className, x, y }));
}

export function parseSvgToPaths(svgText: string): PathDocument {
  const defsMatch = svgText.match(/<defs>([\s\S]*?)<\/defs>/i);
  const styleMatch = defsMatch?.[1]?.match(/<style>([\s\S]*?)<\/style>/i);
  const styleCss = styleMatch ? styleMatch[1].trim() : "";
  const viewBox = svgText.match(/viewBox="([^"]+)"/i)?.[1] ?? "0 0 2048 2048";
  const art = extractArtMarkup(svgText);

  const shapes: PathShape[] = [];
  let match: RegExpExecArray | null;
  shapeRe.lastIndex = 0;
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

  if (!shapes.length) {
    throw new Error("No path, polygon, or rect elements found in SVG");
  }

  return { viewBox, styleCss, shapes };
}

export function defaultGroupsForSvg(svgId: string): Record<string, string[]> {
  const builtin = getBuiltinSvg(svgId);
  if (builtin) return structuredClone(builtin.groups);
  return structuredClone(EMPTY_GROUP_TEMPLATE);
}

function readSessionsMap(): Record<string, LabSession> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LAB_SESSIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, LabSession>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeSessionsMap(sessions: Record<string, LabSession>) {
  try {
    localStorage.setItem(LAB_SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    // ignore quota / private browsing errors
  }
}

function migrateSessionMotion(
  motion: Record<string, GroupMotionConfig> | undefined,
  svgId?: string
): Record<string, GroupMotionConfig> {
  if (!motion) return {};
  const next: Record<string, GroupMotionConfig> = {};
  for (const [key, value] of Object.entries(motion)) {
    if (value && typeof value === "object" && "peakDeg" in value) {
      const mode =
        svgId === BRAIN_SVG_ID && value.mode === "spin"
          ? "spin-center"
          : value.mode;
      next[key] = mode === value.mode ? value : { ...value, mode };
    }
  }
  if (next.hair && !next["hair-back"]) {
    next["hair-back"] = next.hair;
  }
  delete next.hair;
  return next;
}

function defaultSessionForSvg(svgId: string): LabSession {
  const builtin = getBuiltinSvg(svgId);
  const groups = defaultGroupsForSvg(svgId);
  if (builtin) {
    return {
      groups,
      groupOrder: mergeStoredGroupOrders(Object.keys(groups), builtin.session.groupOrder),
      splits: structuredClone(builtin.session.splits),
      pivots: structuredClone(builtin.session.pivots),
      motion: migrateSessionMotion(
        structuredClone(builtin.session.motion) as Record<string, GroupMotionConfig>,
        svgId
      ),
      motionDriver: parseMotionDriver(builtin.session.motionDriver, "scroll"),
    };
  }

  return {
    groups,
    groupOrder: mergeStoredGroupOrders(Object.keys(groups)),
    splits: {},
    pivots: {},
    motion: {},
    motionDriver: "scroll",
  };
}

export function readLabSession(svgId: string): LabSession {
  const sessions = readSessionsMap();
  const stored = sessions[svgId];
  const template = defaultGroupsForSvg(svgId);
  if (stored) {
    const groups = mergeStoredGroups(stored.groups ?? template, template);
    return {
      groups,
      groupOrder: mergeStoredGroupOrders(Object.keys(groups), stored.groupOrder),
      splits: stored.splits ?? {},
      pivots: stored.pivots ?? {},
      motion: migrateSessionMotion(stored.motion, svgId),
      motionDriver: parseMotionDriver(
        stored.motionDriver,
        parseMotionDriver(getBuiltinSvg(svgId)?.session.motionDriver, "scroll")
      ),
    };
  }

  return defaultSessionForSvg(svgId);
}

export function writeLabSession(svgId: string, session: LabSession, viewBox: string) {
  const sessions = readSessionsMap();
  sessions[svgId] = session;
  writeSessionsMap(sessions);

  if (svgId === DEFAULT_SVG_ID) {
    try {
      localStorage.setItem(
        HOSHINO_GROUPS_STORAGE_KEY,
        JSON.stringify({ viewBox, groups: session.groups })
      );
      localStorage.setItem(
        HOSHINO_SPLITS_STORAGE_KEY,
        JSON.stringify({ viewBox, splits: session.splits })
      );
      localStorage.setItem(
        HOSHINO_PIVOTS_STORAGE_KEY,
        JSON.stringify({ viewBox, pivots: session.pivots })
      );
    } catch {
      // ignore
    }
  }
}

export function clearLabSession(svgId: string, viewBox: string) {
  writeLabSession(svgId, defaultSessionForSvg(svgId), viewBox);
}

export function readSavedSvgs(): SavedSvg[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LAB_SVG_LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedSvg[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeSavedSvgs(entries: SavedSvg[]) {
  try {
    localStorage.setItem(LAB_SVG_LIBRARY_KEY, JSON.stringify(entries));
  } catch {
    // ignore
  }
}

export function readDefaultShapeOverrides(): Record<string, DefaultShapeOverride> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LAB_DEFAULT_SHAPE_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, DefaultShapeOverride>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeDefaultShapeOverride(shapeId: string, override: DefaultShapeOverride) {
  try {
    const next = { ...readDefaultShapeOverrides(), [shapeId]: override };
    localStorage.setItem(LAB_DEFAULT_SHAPE_OVERRIDES_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / private browsing errors
  }
}

export function applyDefaultShapeOverrides(
  shapes: PathShape[],
  overrides: Record<string, DefaultShapeOverride> = readDefaultShapeOverrides()
): PathShape[] {
  if (!Object.keys(overrides).length) return shapes;
  return shapes.map((shape) => {
    const patch = overrides[shape.id];
    if (!patch) return shape;
    return {
      ...shape,
      ...(patch.attrs ? { attrs: { ...shape.attrs, ...patch.attrs } } : {}),
      ...(patch.silhouetteD !== undefined ? { silhouetteD: patch.silhouetteD } : {}),
      ...(patch.paintLayers !== undefined ? { paintLayers: patch.paintLayers } : {}),
    };
  });
}

function normalizeActiveSvgId(id: string | null | undefined): string {
  if (!id) return DEFAULT_SVG_ID;
  return id;
}

export function readActiveSvgId(): string {
  if (typeof window === "undefined") return DEFAULT_SVG_ID;
  try {
    return normalizeActiveSvgId(localStorage.getItem(LAB_ACTIVE_SVG_KEY));
  } catch {
    return DEFAULT_SVG_ID;
  }
}

export function writeActiveSvgId(id: string) {
  try {
    localStorage.setItem(LAB_ACTIVE_SVG_KEY, id);
  } catch {
    // ignore
  }
}

export function normalizeSvgName(raw: string) {
  return raw.trim().replace(/\.svg$/i, "") || "untitled-svg";
}
