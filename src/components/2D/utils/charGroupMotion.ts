import brainLabSession from "@/components/2D/assets/brain/lab-session.json";
import { getBaseShapeId, type PathSplit } from "@/components/2D/utils/charPathSplits";
import {
  isArmGroup,
  parsePivotOrigin,
  resolveArmPivotPoint,
  type ArmPivotConfig,
} from "@/components/2D/utils/charPathPivots";
import {
  computeCentroidPivot,
  computeHeadCrownPivot,
  computeHipPivot,
  computeNeckPivot,
  pivotPx,
} from "@/components/2D/utils/charMotionPivots";

const DEFAULT_SCROLL_MID = 0.45;
const DEFAULT_SCROLL_DURATION = 2.5;
const SCROLL_MID_RATIO = 0.55;

type ManifestPoint = { x: number; y: number };

export type GroupMotionDirection = 1 | -1;
export type GroupMotionMode = "sway" | "spin" | "spin-center";

/** Per-group test-motion settings (matches HoshinoCharacter scroll magnitudes). */
export type GroupMotionConfig = {
  peakDeg: number;
  direction: GroupMotionDirection;
  duration: number;
  /**
   * sway = ease in-out rock around a group pivot.
   * spin = linear 0→peak around the group pivot.
   * spin-center = linear 0→peak around the path/group bounding-box center
   * (Brain.tsx `style={{ rotate }}` / fill-box 50% 50%).
   */
  mode?: GroupMotionMode;
  /** Keep turning in one direction instead of reversing when the cycle ends. */
  continuous?: boolean;
};

export function isLinearSpinMode(mode?: GroupMotionMode) {
  return mode === "spin" || mode === "spin-center";
}

function parseMotionMode(mode: unknown, fallback: GroupMotionMode): GroupMotionMode {
  if (mode === "sway" || mode === "spin" || mode === "spin-center") return mode;
  return fallback;
}

const PARENT_SUBGROUPS: Record<string, readonly string[]> = {
  top: ["hair-back", "hair-front", "head", "hat"],
  middle: ["torso", "arm-left", "arm-right"],
  bottom: ["skirt", "leg-left", "leg-right"],
};

/** Max degrees at full scroll — from HoshinoCharacter. */
const HOSHINO_PEAK_DEG: Record<string, number> = {
  torso: 1.2,
  head: 4,
  hat: 1.5,
  "hair-back": 0.8,
  "hair-front": 0.8,
  "arm-left": 3.5,
  "arm-right": 3.5,
  skirt: 2,
  "leg-left": 1,
  "leg-right": 1,
  detail: 2,
  top: 3,
  middle: 2,
  bottom: 1.5,
};

const DEFAULT_DIRECTION: Record<string, GroupMotionDirection> = {
  "arm-left": -1,
  "arm-right": 1,
  "leg-left": 1,
  "leg-right": -1,
};

const BRAIN_MOTION = (brainLabSession.motion ?? {}) as Record<
  string,
  Partial<GroupMotionConfig>
>;

export function defaultMotionForGroup(group: string): GroupMotionConfig {
  const brain = BRAIN_MOTION[group];
  if (brain?.peakDeg != null) {
    const mode = parseMotionMode(brain.mode, "spin-center");
    return {
      peakDeg: brain.peakDeg,
      direction: (brain.direction as GroupMotionDirection) ?? 1,
      duration: brain.duration ?? 2.5,
      mode,
      continuous: brain.continuous ?? isLinearSpinMode(mode),
    };
  }
  return {
    peakDeg: HOSHINO_PEAK_DEG[group] ?? 2,
    direction: DEFAULT_DIRECTION[group] ?? 1,
    duration: 2.5,
    mode: "sway",
    continuous: false,
  };
}

export function resolveGroupMotionConfig(
  group: string,
  stored?: Partial<GroupMotionConfig>
): GroupMotionConfig {
  return { ...defaultMotionForGroup(group), ...stored };
}

export function peakRotateDeg(config: GroupMotionConfig): number {
  return config.peakDeg * config.direction;
}

/** Scroll progress (0–1) at which sway reaches its mid keyframe. */
export function scrollMidProgress(duration: number): number {
  return Math.min(
    0.8,
    Math.max(0.25, DEFAULT_SCROLL_MID * (DEFAULT_SCROLL_DURATION / duration))
  );
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Map scroll progress to rotation degrees using lab peak/duration settings. */
export function scrollSwayAtProgress(
  progress: number,
  config: GroupMotionConfig
): number {
  const peak = peakRotateDeg(config);
  if (progress <= 0) return 0;
  if (progress >= 1) return peak;

  const midT = scrollMidProgress(config.duration);
  const midPeak = peak * SCROLL_MID_RATIO;
  if (progress <= midT) return lerp(0, midPeak, progress / midT);
  return lerp(midPeak, peak, (progress - midT) / (1 - midT));
}

/** Linear scroll mapping (used for legs). */
export function scrollSwayAtProgressLinear(
  progress: number,
  config: GroupMotionConfig
): number {
  return progress * peakRotateDeg(config);
}

export function motionKindForGroup(
  group: string,
  config?: GroupMotionConfig
): "arm" | "group" | "spin" | "spin-center" {
  const mode = config?.mode ?? defaultMotionForGroup(group).mode;
  if (mode === "spin-center") return "spin-center";
  if (mode === "spin") return "spin";
  return isArmGroup(group) ? "arm" : "group";
}

function uniqueBaseIds(groups: Record<string, string[]>, name: string) {
  return [...new Set((groups[name] ?? []).map(getBaseShapeId))];
}

function parentSubgroupIds(groups: Record<string, string[]>, parent: string) {
  const subgroups = PARENT_SUBGROUPS[parent];
  if (!subgroups) return uniqueBaseIds(groups, parent);
  return [
    ...new Set(subgroups.flatMap((name) => uniqueBaseIds(groups, name))),
  ];
}

/** Pivot for lab test motion — mirrors HoshinoCharacter layering. */
export function resolveGroupMotionPivot(
  group: string,
  groups: Record<string, string[]>,
  armPivots: ArmPivotConfig,
  manifestById: Map<string, ManifestPoint>,
  splits: Record<string, PathSplit>
): { x: number; y: number } {
  const headIds = uniqueBaseIds(groups, "head");
  const ids = uniqueBaseIds(groups, group);

  if (isArmGroup(group)) {
    return resolveArmPivotPoint(
      group,
      armPivots[group],
      ids,
      manifestById,
      splits
    );
  }

  let origin: string;
  switch (group) {
    case "torso":
      origin = pivotPx(1024, 1180);
      break;
    case "head":
      origin = computeNeckPivot(ids, manifestById);
      break;
    case "hat":
      origin = computeHeadCrownPivot(headIds, manifestById);
      break;
    case "hair-back":
    case "hair-front":
      origin = computeNeckPivot(headIds, manifestById);
      break;
    case "skirt":
      origin = computeCentroidPivot(ids, manifestById);
      break;
    case "leg-left":
      origin = computeHipPivot(ids, manifestById, "left");
      break;
    case "leg-right":
      origin = computeHipPivot(ids, manifestById, "right");
      break;
    case "detail":
      origin = computeNeckPivot(headIds, manifestById);
      break;
  case "top":
  case "middle":
  case "bottom":
      origin = computeCentroidPivot(parentSubgroupIds(groups, group), manifestById);
      break;
    default:
      origin = computeCentroidPivot(ids, manifestById);
      break;
  }

  return parsePivotOrigin(origin);
}

export function motionPivotOrigin(
  group: string,
  groups: Record<string, string[]>,
  armPivots: ArmPivotConfig,
  manifestById: Map<string, ManifestPoint>,
  splits: Record<string, PathSplit>
): string {
  const { x, y } = resolveGroupMotionPivot(
    group,
    groups,
    armPivots,
    manifestById,
    splits
  );
  return pivotPx(x, y);
}
