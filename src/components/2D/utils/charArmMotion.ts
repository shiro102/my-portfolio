import type { MotionStyle, TransformProperties } from "framer-motion";
import { getBaseShapeId } from "@/components/2D/utils/charPathSplits";

/** How much the arm lengthens / squeezes along the bone at peak swing (degrees). */
export const ARM_BONE_SCALE_GAIN = 0.16;

/** Lengthen when swinging up (positive °), squeeze when swinging down. */
export function armBoneScaleFromRotation(
  degrees: number,
  gain = ARM_BONE_SCALE_GAIN
): number {
  return 1 + gain * Math.sin((degrees * Math.PI) / 180);
}

/** Slight width compensation so stretch doesn't look paper-thin. */
export function armWidthScaleFromBoneScale(boneScale: number): number {
  return 1 + (1 - boneScale) * 0.3;
}

type ManifestPoint = { x: number; y: number };

export function parseMotionNumber(
  value: string | number | undefined,
  fallback: number
): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Rotate/scale at the current origin — pair with outer `translate(cx,cy)` + inner `translate(-cx,-cy)`. */
export function armHingeRotateScaleTemplate() {
  return (transform: TransformProperties) => {
    const rotate = parseMotionNumber(transform.rotate, 0);
    const sx = parseMotionNumber(transform.scaleX, 1);
    const sy = parseMotionNumber(transform.scaleY, 1);
    return `rotate(${rotate}) scale(${sx} ${sy})`;
  };
}

/** Inner motion node when not using transformTemplate (e.g. nested groups). */
export function armHingeInnerStyle(): MotionStyle {
  return { transformOrigin: "0px 0px" };
}

export function armHingeOffset(cx: number, cy: number) {
  return { pivot: `translate(${cx} ${cy})`, content: `translate(${-cx} ${-cy})` };
}

/** Farthest path from the pivot — the free end of the stick. */
export function computeArmDistalAngleDeg(
  pivot: { x: number; y: number },
  pathIds: string[],
  manifestById: Map<string, ManifestPoint>,
  side: "left" | "right"
): number {
  let bestDist = -1;
  let tipX = pivot.x;
  let tipY = pivot.y + 120;

  for (const id of pathIds) {
    const meta = manifestById.get(getBaseShapeId(id));
    if (!meta) continue;
    const dx = meta.x - pivot.x;
    const dy = meta.y - pivot.y;
    const dist = dx * dx + dy * dy;
    if (dist > bestDist) {
      bestDist = dist;
      tipX = meta.x;
      tipY = meta.y;
    }
  }

  if (bestDist <= 0) return side === "left" ? 140 : 40;
  return (Math.atan2(tipY - pivot.y, tipX - pivot.x) * 180) / Math.PI;
}

export function armMotionKeyframes(peakRotateDeg: number, gain = ARM_BONE_SCALE_GAIN) {
  const peakScale = armBoneScaleFromRotation(peakRotateDeg, gain);
  const peakWidth = armWidthScaleFromBoneScale(peakScale);
  return {
    rotate: [0, peakRotateDeg, 0] as number[],
    scaleX: [1, peakScale, 1] as number[],
    scaleY: [1, peakWidth, 1] as number[],
  };
}

/** Peak test-motion angle (°) — arm swings down from the pivot. */
export function armTestMotionPeakDeg(
  group: "arm-left" | "arm-right",
  magnitude = 4
): number {
  return group === "arm-left" ? -magnitude : magnitude;
}
