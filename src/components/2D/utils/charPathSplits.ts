export type SplitAxis = "x" | "y" | "angle";
export type SplitPart = "a" | "b";

export type PathSplit = {
  axis: SplitAxis;
  /** X coord, Y coord, or angle in degrees (0° = east, 90° = south in SVG space). */
  value: number;
  /** Point on the line — required when axis is `angle`. */
  px?: number;
  py?: number;
};

export const HOSHINO_SPLITS_STORAGE_KEY = "animation-lab-splits";
export const SPLIT_SEP = "__";
/** Slight overlap at clip edges so antialiasing does not leave a visible seam. */
export const SPLIT_CLIP_OVERLAP = 3;

type Point = { x: number; y: number };

export function isSplitShapeId(id: string): boolean {
  return /__a$|__b$/.test(id);
}

export function parseSplitShapeId(id: string): { baseId: string; part: SplitPart } | null {
  const match = id.match(/^(.+)__(a|b)$/);
  if (!match) return null;
  return { baseId: match[1], part: match[2] as SplitPart };
}

export function makeSplitShapeId(baseId: string, part: SplitPart): string {
  return `${baseId}${SPLIT_SEP}${part}`;
}

export function getBaseShapeId(id: string): string {
  return parseSplitShapeId(id)?.baseId ?? id;
}

export function splitClipPathId(baseId: string, part: SplitPart): string {
  return `hoshino-split-${baseId.replace(/[^a-zA-Z0-9_-]/g, "-")}-${part}`;
}

function parseViewBox(viewBox: string) {
  const [vx, vy, vw, vh] = viewBox.split(/\s+/).map(Number);
  return { vx, vy, vw, vh };
}

function viewBoxCorners(viewBox: string): Point[] {
  const { vx, vy, vw, vh } = parseViewBox(viewBox);
  return [
    { x: vx, y: vy },
    { x: vx + vw, y: vy },
    { x: vx + vw, y: vy + vh },
    { x: vx, y: vy + vh },
  ];
}

/** Signed distance to split line; part `a` is the non-negative side. */
export function splitSignedDistance(x: number, y: number, split: PathSplit): number {
  if (split.axis === "y") return split.value - y;
  if (split.axis === "x") return split.value - x;

  const rad = (split.value * Math.PI) / 180;
  const nx = -Math.sin(rad);
  const ny = Math.cos(rad);
  const px = split.px ?? 1024;
  const py = split.py ?? 1024;
  return (x - px) * nx + (y - py) * ny;
}

function pointOnPart(
  x: number,
  y: number,
  split: PathSplit,
  part: SplitPart,
  forClip = false
): boolean {
  const d = splitSignedDistance(x, y, split);
  if (forClip) {
    return part === "a" ? d >= -SPLIT_CLIP_OVERLAP : d <= SPLIT_CLIP_OVERLAP;
  }
  return part === "a" ? d >= 0 : d <= 0;
}

/** Clip polygon edge along the split — offset so adjacent halves overlap (no hairline gap). */
function segmentClipBoundaryIntersection(
  a: Point,
  b: Point,
  split: PathSplit,
  part: SplitPart
): Point | null {
  const edge = part === "a" ? -SPLIT_CLIP_OVERLAP : SPLIT_CLIP_OVERLAP;
  const da = splitSignedDistance(a.x, a.y, split) - edge;
  const db = splitSignedDistance(b.x, b.y, split) - edge;
  if (Math.abs(da - db) < 1e-12) return null;
  const t = da / (da - db);
  if (t < 0 || t > 1) return null;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

export function readStoredSplits(): Record<string, PathSplit> {
  if (typeof window === "undefined") return {};

  try {
    const raw = localStorage.getItem(HOSHINO_SPLITS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { splits?: unknown };
    if (!parsed.splits || typeof parsed.splits !== "object") return {};

    const splits: Record<string, PathSplit> = {};
    for (const [baseId, value] of Object.entries(parsed.splits as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as PathSplit;
      const axis = entry.axis;
      const splitValue = entry.value;
      if (typeof splitValue !== "number" || !Number.isFinite(splitValue)) continue;

      if (axis === "x" || axis === "y") {
        splits[baseId] = { axis, value: splitValue };
        continue;
      }

      if (
        axis === "angle" &&
        typeof entry.px === "number" &&
        typeof entry.py === "number" &&
        Number.isFinite(entry.px) &&
        Number.isFinite(entry.py)
      ) {
        splits[baseId] = {
          axis: "angle",
          value: splitValue,
          px: entry.px,
          py: entry.py,
        };
      }
    }
    return splits;
  } catch {
    return {};
  }
}

/** Polygon clip for any split type (half-plane ∩ viewBox). */
export function clipPolygonPointsForPart(
  viewBox: string,
  split: PathSplit,
  part: SplitPart
): string {
  const corners = viewBoxCorners(viewBox);
  const ordered: Point[] = [];

  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const aInside = pointOnPart(a.x, a.y, split, part, true);
    const bInside = pointOnPart(b.x, b.y, split, part, true);

    if (aInside) ordered.push(a);

    if (aInside !== bInside) {
      const hit = segmentClipBoundaryIntersection(a, b, split, part);
      if (hit) ordered.push(hit);
    }
  }

  if (ordered.length < 3) {
    const { vx, vy, vw, vh } = parseViewBox(viewBox);
    return `${vx},${vy} ${vx + vw},${vy} ${vx + vw},${vy + vh} ${vx},${vy + vh}`;
  }

  return ordered.map((p) => `${p.x},${p.y}`).join(" ");
}

/** @deprecated Prefer clipPolygonPointsForPart — kept for callers expecting rects on axis splits. */
export function clipRectForPart(
  viewBox: string,
  split: PathSplit,
  part: SplitPart
): { x: number; y: number; width: number; height: number } {
  const [vx, vy, vw, vh] = viewBox.split(/\s+/).map(Number);

  if (split.axis === "y") {
    if (part === "a") {
      return { x: vx, y: vy, width: vw, height: Math.max(0, split.value - vy) };
    }
    return { x: vx, y: split.value, width: vw, height: Math.max(0, vy + vh - split.value) };
  }

  if (split.axis === "x") {
    if (part === "a") {
      return { x: vx, y: vy, width: Math.max(0, split.value - vx), height: vh };
    }
    return { x: split.value, y: vy, width: Math.max(0, vx + vw - split.value), height: vh };
  }

  const pts = clipPolygonPointsForPart(viewBox, split, part)
    .split(/\s+/)
    .map((pair) => pair.split(",").map(Number))
    .filter((coords) => coords.length === 2);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function splitLineEndpoints(
  viewBox: string,
  split: PathSplit
): { x1: number; y1: number; x2: number; y2: number } {
  const { vx, vy, vw, vh } = parseViewBox(viewBox);

  if (split.axis === "y") {
    return { x1: vx, y1: split.value, x2: vx + vw, y2: split.value };
  }
  if (split.axis === "x") {
    return { x1: split.value, y1: vy, x2: split.value, y2: vy + vh };
  }

  const px = split.px ?? 1024;
  const py = split.py ?? 1024;
  const rad = (split.value * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const len = Math.max(vw, vh) * 1.5;
  return {
    x1: px - dx * len,
    y1: py - dy * len,
    x2: px + dx * len,
    y2: py + dy * len,
  };
}

export function pointInSplitPart(
  x: number,
  y: number,
  split: PathSplit,
  part: SplitPart
): boolean {
  return pointOnPart(x, y, split, part);
}

export type LabRenderable<T extends { id: string }> = {
  id: string;
  shape: T;
  part: SplitPart | null;
  split: PathSplit | null;
};

export function expandShapesForLab<T extends { id: string }>(
  shapes: T[],
  splits: Record<string, PathSplit>
): LabRenderable<T>[] {
  const items: LabRenderable<T>[] = [];
  for (const shape of shapes) {
    const split = splits[shape.id];
    if (!split) {
      items.push({ id: shape.id, shape, part: null, split: null });
      continue;
    }
    items.push({ id: makeSplitShapeId(shape.id, "a"), shape, part: "a", split });
    items.push({ id: makeSplitShapeId(shape.id, "b"), shape, part: "b", split });
  }
  return items;
}

export function migrateGroupsForSplit(
  groups: Record<string, string[]>,
  baseId: string
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const [name, ids] of Object.entries(groups)) {
    if (!ids.includes(baseId)) {
      next[name] = ids;
      continue;
    }
    const without = ids.filter((id) => id !== baseId);
    next[name] = [
      ...without,
      makeSplitShapeId(baseId, "a"),
      makeSplitShapeId(baseId, "b"),
    ];
  }
  return next;
}

export function migrateGroupsForUnsplit(
  groups: Record<string, string[]>,
  baseId: string
): Record<string, string[]> {
  const idA = makeSplitShapeId(baseId, "a");
  const idB = makeSplitShapeId(baseId, "b");
  const next: Record<string, string[]> = {};
  for (const [name, ids] of Object.entries(groups)) {
    const filtered = ids.filter((id) => id !== idA && id !== idB);
    if (ids.includes(idA) || ids.includes(idB)) {
      next[name] = [...filtered, baseId];
    } else {
      next[name] = filtered;
    }
  }
  return next;
}

export function buildSplitDraft(
  axis: SplitAxis,
  value: number,
  px: number,
  py: number
): PathSplit {
  if (axis === "angle") return { axis, value, px, py };
  return { axis, value };
}
