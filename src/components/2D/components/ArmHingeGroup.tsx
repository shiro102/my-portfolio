"use client";

import { animate, type MotionValue } from "framer-motion";
import { useEffect, useRef } from "react";
import {
  armHingeOffset,
  armMotionKeyframes,
} from "@/components/2D/utils/charArmMotion";

function innerTransform(rotate: number, scaleX: number, scaleY: number) {
  if (scaleX === 1 && scaleY === 1) return `rotate(${rotate})`;
  return `rotate(${rotate}) scale(${scaleX} ${scaleY})`;
}

type LiveMotion = {
  rotate: MotionValue<number>;
  scaleX?: MotionValue<number>;
  scaleY?: MotionValue<number>;
};

export type LabHingeMotion =
  | { kind: "arm"; peakRotateDeg: number; duration?: number; continuous?: boolean }
  | { kind: "group"; peakRotateDeg: number; duration?: number; continuous?: boolean }
  | { kind: "spin"; peakRotateDeg: number; duration?: number; continuous?: boolean }
  | { kind: "spin-center"; peakRotateDeg: number; duration?: number; continuous?: boolean };

export type HingeOriginMode = "pivot" | "fill-center";

type ArmHingeGroupProps = {
  cx: number;
  cy: number;
  children: React.ReactNode;
  labMotion?: LabHingeMotion;
  liveMotion?: LiveMotion;
  /** fill-center = bounding-box midpoint (Brain path rotate). Default: explicit (cx, cy). */
  originMode?: HingeOriginMode;
};

const ROTATE_EPS = 0.0008;
const SCALE_EPS = 0.00008;

function cssTransform(rotate: number, scaleX: number, scaleY: number) {
  if (scaleX === 1 && scaleY === 1) return `rotate(${rotate}deg)`;
  return `rotate(${rotate}deg) scale(${scaleX}, ${scaleY})`;
}

function isLinearSpinKind(kind: LabHingeMotion["kind"]) {
  return kind === "spin" || kind === "spin-center";
}

function resolveOriginMode(
  labMotion?: LabHingeMotion,
  originMode?: HingeOriginMode
): HingeOriginMode {
  if (labMotion?.kind === "spin-center") return "fill-center";
  return originMode ?? "pivot";
}

/** CSS transform around the SVG viewBox pivot — compositor-friendly, same math as nested SVG translates. */
function applyHingeTransform(
  el: SVGGElement,
  cx: number,
  cy: number,
  rotate: number,
  scaleX: number,
  scaleY: number,
  originMode: HingeOriginMode = "pivot"
) {
  if (originMode === "fill-center") {
    el.style.transformBox = "fill-box";
    el.style.transformOrigin = "50% 50%";
    el.style.transform = cssTransform(rotate, scaleX, scaleY);
    if (el.hasAttribute("transform")) el.removeAttribute("transform");
    return;
  }

  const vb = el.ownerSVGElement?.viewBox.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) {
    const ox = ((cx - vb.x) / vb.width) * 100;
    const oy = ((cy - vb.y) / vb.height) * 100;
    el.style.transformBox = "view-box";
    el.style.transformOrigin = `${ox}% ${oy}%`;
    el.style.transform = cssTransform(rotate, scaleX, scaleY);
    if (el.hasAttribute("transform")) el.removeAttribute("transform");
    return;
  }

  const hinge = armHingeOffset(cx, cy);
  el.setAttribute(
    "transform",
    `${hinge.pivot} ${innerTransform(rotate, scaleX, scaleY)} ${hinge.content}`
  );
}

/** Hinge at (cx, cy). Prefers CSS transforms so scroll motion is GPU-composited. */
export function ArmHingeGroup({
  cx,
  cy,
  children,
  labMotion,
  liveMotion,
  originMode,
}: ArmHingeGroupProps) {
  const innerRef = useRef<SVGGElement>(null);
  const hingeOrigin = resolveOriginMode(labMotion, originMode);

  useEffect(() => {
    const el = innerRef.current;
    if (!el || !labMotion) return;

    const duration = labMotion.duration ?? 2.5;
    const peak = labMotion.peakRotateDeg;

    if (labMotion.continuous) {
      const absPeak = Math.abs(peak);
      if (absPeak < 0.0001) {
        applyHingeTransform(el, cx, cy, 0, 1, 1, hingeOrigin);
        return;
      }
      const degPerMs = peak / (duration * 1000);
      const t0 = performance.now();
      let raf = 0;
      const tick = (now: number) => {
        applyHingeTransform(el, cx, cy, degPerMs * (now - t0), 1, 1, hingeOrigin);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }

    const motion =
      labMotion.kind === "arm"
        ? armMotionKeyframes(labMotion.peakRotateDeg)
        : isLinearSpinKind(labMotion.kind)
          ? {
              rotate: [0, labMotion.peakRotateDeg] as number[],
              scaleX: [1, 1] as number[],
              scaleY: [1, 1] as number[],
            }
          : {
              rotate: [0, labMotion.peakRotateDeg, 0] as number[],
              scaleX: [1, 1, 1] as number[],
              scaleY: [1, 1, 1] as number[],
            };

    const state = { rotate: 0, scaleX: 1, scaleY: 1 };
    applyHingeTransform(el, cx, cy, 0, 1, 1, hingeOrigin);

    const controls = animate(
      state,
      {
        rotate: motion.rotate,
        scaleX: motion.scaleX,
        scaleY: motion.scaleY,
      },
      {
        duration,
        repeat: Infinity,
        ease: isLinearSpinKind(labMotion.kind) ? "linear" : "easeInOut",
        onUpdate: () => {
          applyHingeTransform(el, cx, cy, state.rotate, state.scaleX, state.scaleY, hingeOrigin);
        },
      }
    );

    return () => controls.stop();
  }, [cx, cy, hingeOrigin, labMotion?.continuous, labMotion?.kind, labMotion?.peakRotateDeg, labMotion?.duration]);

  useEffect(() => {
    const el = innerRef.current;
    if (!el || !liveMotion) return;

    const rotateMv = liveMotion.rotate;
    const scaleXMv = liveMotion.scaleX;
    const scaleYMv = liveMotion.scaleY;
    let lastRotate = Number.NaN;
    let lastScaleX = Number.NaN;
    let lastScaleY = Number.NaN;
    let queued = false;

    const flush = () => {
      queued = false;
      const rotate = rotateMv.get();
      const scaleX = scaleXMv?.get() ?? 1;
      const scaleY = scaleYMv?.get() ?? 1;
      if (
        Math.abs(rotate - lastRotate) < ROTATE_EPS &&
        Math.abs(scaleX - lastScaleX) < SCALE_EPS &&
        Math.abs(scaleY - lastScaleY) < SCALE_EPS
      ) {
        return;
      }
      lastRotate = rotate;
      lastScaleX = scaleX;
      lastScaleY = scaleY;
      applyHingeTransform(el, cx, cy, rotate, scaleX, scaleY, hingeOrigin);
    };

    const schedule = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(flush);
    };

    flush();
    const unsubs = [rotateMv.on("change", schedule)];
    if (scaleXMv) unsubs.push(scaleXMv.on("change", schedule));
    if (scaleYMv) unsubs.push(scaleYMv.on("change", schedule));
    return () => {
      for (const unsub of unsubs) unsub();
      queued = false;
    };
  }, [cx, cy, hingeOrigin, liveMotion?.rotate, liveMotion?.scaleX, liveMotion?.scaleY]);

  return (
    <g
      ref={innerRef}
      style={{
        transformBox: hingeOrigin === "fill-center" ? "fill-box" : "view-box",
        transformOrigin: hingeOrigin === "fill-center" ? "50% 50%" : "0% 0%",
        willChange: "transform",
      }}
    >
      {children}
    </g>
  );
}
