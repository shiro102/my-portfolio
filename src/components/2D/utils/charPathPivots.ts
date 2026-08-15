import {
  getBaseShapeId,
  parseSplitShapeId,
  pointInSplitPart,
  type PathSplit,
} from "@/components/2D/utils/charPathSplits";
import {
  isPointInFilledShape,
  isPointInLocalBBox,
} from "@/components/2D/utils/charPathContainment";
import {
  computeShoulderPivot,
  pivotPx,
} from "@/components/2D/utils/charMotionPivots";

export type ArmGroupName = "arm-left" | "arm-right";

export type ArmPivotEntry = {
  pathId: string;
  /** User-chosen hinge in viewBox coords — must lie inside pathId geometry. */
  x?: number;
  y?: number;
};

export type ArmPivotConfig = Partial<Record<ArmGroupName, ArmPivotEntry>>;

export const HOSHINO_PIVOTS_STORAGE_KEY = "animation-lab-pivots";

export const ARM_GROUP_NAMES: ArmGroupName[] = ["arm-left", "arm-right"];

export function isArmGroup(name: string): name is ArmGroupName {
  return name === "arm-left" || name === "arm-right";
}

export function hasCustomPivotPoint(entry: ArmPivotEntry | undefined): boolean {
  return (
    !!entry &&
    entry.x != null &&
    entry.y != null &&
    Number.isFinite(entry.x) &&
    Number.isFinite(entry.y)
  );
}

export function parseArmPivotEntry(raw: unknown): ArmPivotEntry | null {
  if (typeof raw === "string" && raw.length > 0) {
    return { pathId: raw };
  }
  if (!raw || typeof raw !== "object") return null;

  const record = raw as Record<string, unknown>;
  const pathId = record.pathId;
  if (typeof pathId !== "string" || pathId.length === 0) return null;

  const entry: ArmPivotEntry = { pathId };
  if (typeof record.x === "number" && Number.isFinite(record.x)) entry.x = record.x;
  if (typeof record.y === "number" && Number.isFinite(record.y)) entry.y = record.y;
  return entry;
}

export function getArmPivotEntry(
  config: ArmPivotConfig,
  group: ArmGroupName
): ArmPivotEntry | undefined {
  return config[group];
}

export function getArmPivotPathId(
  config: ArmPivotConfig,
  group: ArmGroupName
): string | undefined {
  return config[group]?.pathId;
}

export function readStoredPivots(): ArmPivotConfig {
  if (typeof window === "undefined") return {};

  try {
    const raw = localStorage.getItem(HOSHINO_PIVOTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { pivots?: unknown };
    if (!parsed.pivots || typeof parsed.pivots !== "object") return {};

    const pivots: ArmPivotConfig = {};
    for (const group of ARM_GROUP_NAMES) {
      const entry = parseArmPivotEntry((parsed.pivots as Record<string, unknown>)[group]);
      if (entry) pivots[group] = entry;
    }
    return pivots;
  } catch {
    return {};
  }
}

type ManifestPoint = { x: number; y: number };

/** Nearest point on the split line to (x, y) — the joint between halves. */
function projectOntoSplitLine(
  x: number,
  y: number,
  split: PathSplit
): { x: number; y: number } {
  if (split.axis === "x") return { x: split.value, y };
  if (split.axis === "y") return { x, y: split.value };

  const rad = (split.value * Math.PI) / 180;
  const nx = -Math.sin(rad);
  const ny = Math.cos(rad);
  const px = split.px ?? x;
  const py = split.py ?? y;
  const d = (x - px) * nx + (y - py) * ny;
  return { x: x - d * nx, y: y - d * ny };
}

export function pivotPointFromPath(
  pivotPathId: string | undefined,
  manifestById: Map<string, ManifestPoint>,
  splits: Record<string, PathSplit> = {}
): { x: number; y: number } | null {
  if (!pivotPathId) return null;
  const baseId = getBaseShapeId(pivotPathId);
  const meta = manifestById.get(baseId);
  if (!meta) return null;

  const parsed = parseSplitShapeId(pivotPathId);
  const split = splits[baseId];
  if (parsed && split) {
    return projectOntoSplitLine(meta.x, meta.y, split);
  }

  return { x: meta.x, y: meta.y };
}

export function isPointInArmPivotPath(
  svg: SVGSVGElement,
  pivotPathId: string,
  x: number,
  y: number,
  splits: Record<string, PathSplit>
): boolean {
  const el = svg.getElementById(pivotPathId);
  if (!el || !(el instanceof SVGGeometryElement)) return false;

  const parsed = parseSplitShapeId(pivotPathId);
  const split = splits[getBaseShapeId(pivotPathId)];
  if (parsed && split && !pointInSplitPart(x, y, split, parsed.part)) {
    return false;
  }

  if (isPointInFilledShape(el, svg, x, y)) return true;
  return isPointInLocalBBox(el, svg, x, y);
}

export function resolveArmPivotPoint(
  group: ArmGroupName,
  entry: ArmPivotEntry | undefined,
  armIds: string[],
  manifestById: Map<string, ManifestPoint>,
  splits: Record<string, PathSplit> = {}
): { x: number; y: number } {
  if (entry && hasCustomPivotPoint(entry)) {
    return { x: entry.x!, y: entry.y! };
  }

  if (entry?.pathId) {
    const fromPath = pivotPointFromPath(entry.pathId, manifestById, splits);
    if (fromPath) return fromPath;
  }

  const side = group === "arm-left" ? "left" : "right";
  return parsePivotOrigin(computeShoulderPivot(armIds, manifestById, side));
}

export function resolveArmPivotOrigin(
  group: ArmGroupName,
  entry: ArmPivotEntry | undefined,
  armIds: string[],
  manifestById: Map<string, ManifestPoint>,
  splits: Record<string, PathSplit> = {}
): string {
  const point = resolveArmPivotPoint(group, entry, armIds, manifestById, splits);
  return pivotPx(point.x, point.y);
}

export function parsePivotOrigin(origin: string): { x: number; y: number } {
  const parts = origin.trim().split(/\s+/);
  return {
    x: Number.parseFloat(parts[0] ?? "1024"),
    y: Number.parseFloat(parts[1] ?? "1024"),
  };
}
