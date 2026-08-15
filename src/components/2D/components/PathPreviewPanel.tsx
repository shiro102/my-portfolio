"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { Brush, Eraser, Pencil, PencilLine, Pipette } from "lucide-react";
import type {
  ManifestEntry,
  PathShape,
  PathShapeAttrs,
  ShapePaintLayers,
} from "@/components/2D/utils/charLabSvg";
import { getShapeLocalBounds } from "@/components/2D/utils/charLabSvg";
import { FilledPathGeometry } from "@/components/2D/components/FilledPathGeometry";
import {
  joinPathSegments,
  splitPathSegments,
  getShapeSilhouetteD,
} from "@/components/2D/utils/charShapePaint";

type ViewBox = { x: number; y: number; width: number; height: number };

const MIN_PREVIEW_ZOOM = 50;
const MAX_PREVIEW_ZOOM = 400;

type OverlayStroke = {
  id: string;
  d: string;
  color: string;
  filled?: boolean;
};

type OverlayBrushDot = {
  id: string;
  cx: number;
  cy: number;
  r: number;
  color: string;
};

type PreviewTool = "pencil" | "brush" | "eraser" | "eyedropper" | null;

const DEFAULT_BRUSH_RADIUS = 5;
const MIN_BRUSH_RADIUS = 1;
const MAX_BRUSH_RADIUS = 30;
const BRUSH_SPACING = 3;
const ERASE_RADIUS = 8;
/** Outer ring on the brush cursor — light black, high opacity. */
const BRUSH_POINTER_RING = "rgba(39, 39, 42, 0.88)";

type PathPreviewPanelProps = {
  shape: PathShape;
  meta: ManifestEntry;
  styleCss: string;
  previewViewBox: string;
  fillOverride?: string;
  onShapeChange: (
    shapeId: string,
    updates: {
      attrs?: Partial<PathShapeAttrs>;
      fill?: string;
      paintLayers?: ShapePaintLayers;
      silhouetteD?: string;
      clearFill?: boolean;
    }
  ) => void;
};

export function ShapePaintLayersGraphic({
  layers,
  className,
  fillOverride,
}: {
  layers?: ShapePaintLayers;
  className?: string;
  fillOverride?: string;
}) {
  if (!layers) return null;
  return (
    <>
      {layers.strokes.map((stroke, index) =>
        stroke.filled ? (
          <FilledPathGeometry
            key={`stroke-${index}`}
            d={stroke.d}
            className={stroke.color ? undefined : className}
            fill={stroke.color || fillOverride}
            stroke="none"
          />
        ) : (
          <path
            key={`stroke-${index}`}
            d={stroke.d}
            fill="none"
            stroke={stroke.color}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      )}
      {layers.dots.map((dot, index) => (
        <circle key={`dot-${index}`} cx={dot.cx} cy={dot.cy} r={dot.r} fill={dot.color} />
      ))}
    </>
  );
}

type PaintLayerItem = {
  baseId: string;
  paintLayers?: ShapePaintLayers;
  className?: string;
  fillOverride?: string;
};

/** Hand-drawn layers once per base shape — rendered below vector geometry within the same group. */
export function DedupedPaintLayersGraphic({ items }: { items: PaintLayerItem[] }) {
  const seen = new Set<string>();
  return (
    <>
      {items.map((item) => {
        if (seen.has(item.baseId)) return null;
        seen.add(item.baseId);
        if (
          !item.paintLayers?.strokes?.length &&
          !item.paintLayers?.dots?.length
        ) {
          return null;
        }
        return (
          <g key={`paint-${item.baseId}`}>
            <ShapePaintLayersGraphic
              layers={item.paintLayers}
              className={item.className}
              fillOverride={item.fillOverride}
            />
          </g>
        );
      })}
    </>
  );
}

/** Isolated preview is framed from local `d` / getBBox space, which ignores SVG `transform`. */
function renderShapeGeometry(shape: PathShape, props: Record<string, unknown>) {
  const { attrs } = shape;
  const silhouetteD = getShapeSilhouetteD(shape);
  if (shape.tag === "path" && silhouetteD) {
    return (
      <FilledPathGeometry
        d={silhouetteD}
        fillRule={attrs.fillRule as ComponentProps<"path">["fillRule"]}
        {...(props as ComponentProps<"path">)}
      />
    );
  }
  if (shape.tag === "polygon" && attrs.points) {
    return <polygon points={attrs.points} {...props} />;
  }
  if (shape.tag === "rect" && attrs.x != null) {
    return (
      <rect
        x={attrs.x}
        y={attrs.y}
        width={attrs.width}
        height={attrs.height}
        {...props}
      />
    );
  }
  return null;
}

function paddedLocalViewBox(shape: PathShape, fallback: string): ViewBox {
  const local = getShapeLocalBounds(shape);
  if (!local) return parseViewBox(fallback);
  const width = Math.max(1, local.maxX - local.minX);
  const height = Math.max(1, local.maxY - local.minY);
  const pad = Math.max(12, Math.max(width, height) * 0.25);
  return {
    x: local.minX - pad,
    y: local.minY - pad,
    width: width + pad * 2,
    height: height + pad * 2,
  };
}

function cssColorToHex(color: string): string | null {
  if (!color || color === "none" || color === "transparent") return null;
  if (color.startsWith("#")) {
    if (color.length === 4) {
      return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
    }
    return color.slice(0, 7);
  }
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(Number(m[1]))}${hex(Number(m[2]))}${hex(Number(m[3]))}`;
}


function toPaintLayers(
  strokes: OverlayStroke[],
  dots: OverlayBrushDot[]
): ShapePaintLayers {
  return {
    strokes: strokes.map(({ d, color, filled }) => ({
      d,
      color,
      ...(filled ? { filled: true } : {}),
    })),
    dots: dots.map(({ cx, cy, r, color }) => ({ cx, cy, r, color })),
  };
}

function fromPaintLayers(layers?: ShapePaintLayers): {
  strokes: OverlayStroke[];
  dots: OverlayBrushDot[];
} {
  if (!layers) return { strokes: [], dots: [] };
  return {
    strokes: layers.strokes.map((stroke, index) => ({
      id: `stroke-${index}`,
      ...stroke,
    })),
    dots: layers.dots.map((dot, index) => ({
      id: `brush-${index}`,
      ...dot,
    })),
  };
}

function pointsToPathD(points: number[]) {
  if (points.length < 2) return "";
  let d = `M ${points[0]} ${points[1]}`;
  for (let i = 2; i < points.length; i += 2) {
    d += ` L ${points[i]} ${points[i + 1]}`;
  }
  return d;
}

function parsePathPoints(d: string) {
  const points: { x: number; y: number }[] = [];
  const re = /[ML]\s*([-\d.]+)\s+([-\d.]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(d))) {
    points.push({ x: Number(match[1]), y: Number(match[2]) });
  }
  return points;
}

function distanceToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(
    0,
    Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy))
  );
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function strokeHitByEraser(d: string, x: number, y: number, radius: number) {
  const points = parsePathPoints(d);
  if (points.some((p) => Math.hypot(p.x - x, p.y - y) <= radius)) return true;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const next = points[i];
    if (distanceToSegment(x, y, prev.x, prev.y, next.x, next.y) <= radius) {
      return true;
    }
  }
  return false;
}

function parseViewBox(raw: string): ViewBox {
  const [x, y, width, height] = raw.split(/\s+/).map(Number);
  return { x, y, width, height };
}

function formatViewBox(viewBox: ViewBox) {
  return `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`;
}

export function PathPreviewPanel({
  shape,
  meta,
  styleCss,
  previewViewBox,
  fillOverride,
  onShapeChange,
}: PathPreviewPanelProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<{
    pan: boolean;
    startX: number;
    startY: number;
    viewBoxStart: ViewBox;
  } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [viewBox, setViewBox] = useState<ViewBox>(() =>
    paddedLocalViewBox(shape, previewViewBox)
  );
  const [isPanning, setIsPanning] = useState(false);
  const [ctrlPan, setCtrlPan] = useState(false);
  const [activeTool, setActiveTool] = useState<PreviewTool>(null);
  const [color, setColor] = useState(fillOverride ?? "#f472b6");
  const [pathSegments, setPathSegments] = useState<string[]>(() =>
    splitPathSegments(getShapeSilhouetteD(shape) ?? "")
  );
  const [overlayStrokes, setOverlayStrokes] = useState<OverlayStroke[]>([]);
  const [overlayBrushDots, setOverlayBrushDots] = useState<OverlayBrushDot[]>([]);
  const [liveStroke, setLiveStroke] = useState<number[] | null>(null);
  const [brushHover, setBrushHover] = useState<{ x: number; y: number } | null>(null);
  const [brushRadius, setBrushRadius] = useState(DEFAULT_BRUSH_RADIUS);
  const lastBrushPointRef = useRef<{ x: number; y: number } | null>(null);
  const drawingRef = useRef(false);
  const editBaselineRef = useRef<{
    d: string;
    paintLayers?: ShapePaintLayers;
    fill?: string;
  } | null>(null);

  const basePreviewViewBox = useMemo(
    () => paddedLocalViewBox(shape, previewViewBox),
    [
      shape.id,
      shape.silhouetteD,
      shape.attrs.d,
      shape.attrs.points,
      shape.attrs.x,
      shape.attrs.y,
      shape.attrs.width,
      shape.attrs.height,
      previewViewBox,
    ]
  );
  const zoomPercent = useMemo(
    () => Math.round((basePreviewViewBox.width / viewBox.width) * 100),
    [basePreviewViewBox.width, viewBox.width]
  );

  const applyZoomPercent = useCallback(
    (percent: number) => {
      const clamped = Math.min(
        MAX_PREVIEW_ZOOM,
        Math.max(MIN_PREVIEW_ZOOM, percent)
      );
      setViewBox((current) => {
        const cx = current.x + current.width / 2;
        const cy = current.y + current.height / 2;
        const width = basePreviewViewBox.width / (clamped / 100);
        const height = basePreviewViewBox.height / (clamped / 100);
        return {
          x: cx - width / 2,
          y: cy - height / 2,
          width,
          height,
        };
      });
    },
    [basePreviewViewBox]
  );

  useEffect(() => {
    setViewBox(basePreviewViewBox);
  }, [basePreviewViewBox, shape.id]);

  useEffect(() => {
    setIsEditing(false);
    setActiveTool(null);
    setLiveStroke(null);
    setBrushHover(null);
    setIsPanning(false);
    pointerRef.current = null;
    lastBrushPointRef.current = null;
    drawingRef.current = false;
    editBaselineRef.current = null;
  }, [shape.id]);

  useEffect(() => {
    setPathSegments(splitPathSegments(getShapeSilhouetteD(shape) ?? ""));
    setColor(fillOverride ?? "#f472b6");
  }, [shape.id, fillOverride, shape.attrs.d, shape.silhouetteD]);

  useEffect(() => {
    if (isEditing) return;
    const { strokes, dots } = fromPaintLayers(shape.paintLayers);
    setOverlayStrokes(strokes);
    setOverlayBrushDots(dots);
  }, [shape.id, shape.paintLayers, isEditing]);

  const pathDraft = useMemo(() => joinPathSegments(pathSegments), [pathSegments]);

  const syncPathSegments = useCallback(
    (segments: string[]) => {
      setPathSegments(segments);
      if (shape.tag !== "path") return;
      const nextD = joinPathSegments(segments);
      onShapeChange(shape.id, { attrs: { d: nextD }, silhouetteD: nextD });
    },
    [onShapeChange, shape.id, shape.tag]
  );

  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap || !isEditing) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 10 : -10;
      setViewBox((current) => {
        const currentPercent = (basePreviewViewBox.width / current.width) * 100;
        const nextPercent = Math.min(
          MAX_PREVIEW_ZOOM,
          Math.max(MIN_PREVIEW_ZOOM, currentPercent + delta)
        );
        const cx = current.x + current.width / 2;
        const cy = current.y + current.height / 2;
        const width = basePreviewViewBox.width / (nextPercent / 100);
        const height = basePreviewViewBox.height / (nextPercent / 100);
        return {
          x: cx - width / 2,
          y: cy - height / 2,
          width,
          height,
        };
      });
    };

    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, [isEditing, basePreviewViewBox]);

  useEffect(() => {
    if (!isEditing) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Control" || e.repeat) return;
      setCtrlPan(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "Control") return;
      setCtrlPan(false);
    };
    const onBlur = () => setCtrlPan(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [isEditing]);

  const collectPaintLayers = useCallback(
    (
      strokes: OverlayStroke[],
      dots: OverlayBrushDot[],
      pendingLiveStroke: number[] | null
    ): ShapePaintLayers => {
      const mergedStrokes = [...strokes];
      if (pendingLiveStroke && pendingLiveStroke.length >= 4) {
        mergedStrokes.push({
          id: `stroke-${mergedStrokes.length}`,
          d: pointsToPathD(pendingLiveStroke),
          color,
          filled: true,
        });
      }
      return toPaintLayers(mergedStrokes, dots);
    },
    [color]
  );

  const commitEdits = useCallback(() => {
    const silhouetteD = pathDraft;
    const paintLayers = collectPaintLayers(overlayStrokes, overlayBrushDots, null);
    const { strokes, dots } = fromPaintLayers(paintLayers);

    onShapeChange(shape.id, {
      ...(shape.tag === "path" ? { attrs: { d: silhouetteD }, silhouetteD } : {}),
      paintLayers,
    });

    setOverlayStrokes(strokes);
    setOverlayBrushDots(dots);
    setLiveStroke(null);
    drawingRef.current = false;
    lastBrushPointRef.current = null;
  }, [
    collectPaintLayers,
    onShapeChange,
    overlayBrushDots,
    overlayStrokes,
    pathDraft,
    shape.id,
    shape.tag,
  ]);

  const persistPaintLayers = useCallback(
    (strokes: OverlayStroke[], dots: OverlayBrushDot[]) => {
      onShapeChange(shape.id, {
        paintLayers: toPaintLayers(strokes, dots),
      });
    },
    [onShapeChange, shape.id]
  );

  const eraseAt = useCallback(
    (x: number, y: number) => {
      setOverlayBrushDots((dots) => {
        const nextDots = dots.filter(
          (dot) => Math.hypot(dot.cx - x, dot.cy - y) > dot.r + ERASE_RADIUS
        );
        setOverlayStrokes((strokes) => {
          const nextStrokes = strokes.filter(
            (stroke) => !strokeHitByEraser(stroke.d, x, y, ERASE_RADIUS)
          );
          if (nextDots.length !== dots.length || nextStrokes.length !== strokes.length) {
            persistPaintLayers(nextStrokes, nextDots);
          }
          return nextStrokes;
        });
        return nextDots;
      });
      setPathSegments((segments) => {
        const next = segments.filter(
          (segment) => !strokeHitByEraser(segment, x, y, ERASE_RADIUS)
        );
        if (shape.tag === "path" && joinPathSegments(next) !== joinPathSegments(segments)) {
          const nextD = joinPathSegments(next);
          onShapeChange(shape.id, { attrs: { d: nextD }, silhouetteD: nextD });
        }
        return next;
      });
      setLiveStroke((prev) => {
        if (!prev || prev.length < 2) return prev;
        const kept: number[] = [];
        for (let i = 0; i < prev.length; i += 2) {
          if (Math.hypot(prev[i] - x, prev[i + 1] - y) > ERASE_RADIUS) {
            kept.push(prev[i], prev[i + 1]);
          }
        }
        return kept.length >= 2 ? kept : null;
      });
    },
    [onShapeChange, persistPaintLayers, shape.id, shape.tag]
  );

  const clearEdits = useCallback(() => {
    const baseline = editBaselineRef.current;
    if (!baseline) return;

    setPathSegments(splitPathSegments(baseline.d));
    const { strokes, dots } = fromPaintLayers(baseline.paintLayers);
    setOverlayStrokes(strokes);
    setOverlayBrushDots(dots);
    setLiveStroke(null);
    setColor(baseline.fill ?? "#f472b6");
    drawingRef.current = false;
    lastBrushPointRef.current = null;
    setBrushHover(null);

    onShapeChange(shape.id, {
      ...(shape.tag === "path"
        ? { attrs: { d: baseline.d }, silhouetteD: baseline.d }
        : {}),
      paintLayers: baseline.paintLayers ?? { strokes: [], dots: [] },
      ...(baseline.fill !== undefined
        ? { fill: baseline.fill }
        : { clearFill: true }),
    });
  }, [onShapeChange, shape.id, shape.tag]);

  const cancelEdits = useCallback(() => {
    clearEdits();
    setActiveTool(null);
    setBrushHover(null);
    editBaselineRef.current = null;
    setIsEditing(false);
  }, [clearEdits]);

  const clientToSvg = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const svgPt = pt.matrixTransform(ctm.inverse());
    return { x: svgPt.x, y: svgPt.y };
  }, []);

  const sampleColorAt = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;

    const target = document.elementFromPoint(clientX, clientY);
    if (target && svg.contains(target)) {
      const style = getComputedStyle(target);
      for (const value of [style.fill, style.stroke, style.color]) {
        const hex = cssColorToHex(value);
        if (hex) return hex;
      }
    }

    return null;
  }, []);

  const addBrushDot = useCallback((x: number, y: number) => {
    const last = lastBrushPointRef.current;
    const spacing = Math.max(BRUSH_SPACING, brushRadius * 0.5);
    if (last && Math.hypot(x - last.x, y - last.y) < spacing) return;
    lastBrushPointRef.current = { x, y };
    setOverlayBrushDots((dots) => {
      const next = [
        ...dots,
        { id: `brush-${dots.length}`, cx: x, cy: y, r: brushRadius, color },
      ];
      setOverlayStrokes((strokes) => {
        persistPaintLayers(strokes, next);
        return strokes;
      });
      return next;
    });
  }, [brushRadius, color, persistPaintLayers]);

  const applyPathDraft = useCallback(
    (nextDraft: string) => {
      syncPathSegments(splitPathSegments(nextDraft));
    },
    [syncPathSegments]
  );

  const appendPencilStroke = useCallback(
    (segmentD: string) => {
      if (!segmentD.trim()) return;
      setOverlayStrokes((strokes) => {
        const next = [
          ...strokes,
          {
            id: `stroke-${strokes.length}`,
            d: segmentD,
            color,
            filled: true as const,
          },
        ];
        setOverlayBrushDots((dots) => {
          persistPaintLayers(next, dots);
          return dots;
        });
        return next;
      });
    },
    [color, persistPaintLayers]
  );

  const previewShape = useMemo(() => {
    if (!isEditing || shape.tag !== "path") return shape;
    return {
      ...shape,
      attrs: { ...shape.attrs, d: pathDraft },
      silhouetteD: pathDraft,
    };
  }, [isEditing, pathDraft, shape]);

  const previewPaintLayers = useMemo(
    () => toPaintLayers(overlayStrokes, overlayBrushDots),
    [overlayStrokes, overlayBrushDots]
  );

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const isPan = e.button === 1 || (e.button === 0 && e.ctrlKey);

    if (isEditing && isPan) {
      e.preventDefault();
      setIsPanning(true);
      pointerRef.current = {
        pan: true,
        startX: e.clientX,
        startY: e.clientY,
        viewBoxStart: { ...viewBox },
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (!isEditing || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    const { x, y } = clientToSvg(e.clientX, e.clientY);

    if (activeTool === "pencil") {
      drawingRef.current = true;
      setLiveStroke([x, y]);
      return;
    }

    if (activeTool === "brush") {
      drawingRef.current = true;
      lastBrushPointRef.current = null;
      addBrushDot(x, y);
      setBrushHover({ x, y });
      return;
    }

    if (activeTool === "eraser") {
      drawingRef.current = true;
      eraseAt(x, y);
      setBrushHover({ x, y });
      return;
    }

    if (activeTool === "eyedropper") {
      const picked = sampleColorAt(e.clientX, e.clientY);
      if (picked) {
        setColor(picked);
        onShapeChange(shape.id, { fill: picked });
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = pointerRef.current;

    if (drag?.pan && drag.viewBoxStart) {
      const svg = svgRef.current;
      if (svg) {
        const rect = svg.getBoundingClientRect();
        const scaleX = drag.viewBoxStart.width / rect.width;
        const scaleY = drag.viewBoxStart.height / rect.height;
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        setViewBox({
          ...drag.viewBoxStart,
          x: drag.viewBoxStart.x - dx * scaleX,
          y: drag.viewBoxStart.y - dy * scaleY,
        });
      }
      return;
    }

    if (!isEditing) return;

    const { x, y } = clientToSvg(e.clientX, e.clientY);

    if (activeTool === "brush") {
      setBrushHover({ x, y });
      if (drawingRef.current) addBrushDot(x, y);
      return;
    }

    if (activeTool === "eraser") {
      setBrushHover({ x, y });
      if (drawingRef.current) eraseAt(x, y);
      return;
    }

    if (!drawingRef.current || activeTool !== "pencil") return;
    setLiveStroke((prev) => (prev ? [...prev, x, y] : [x, y]));
  };

  const handlePointerLeave = () => {
    setBrushHover(null);
  };

  const finishStroke = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastBrushPointRef.current = null;

    if (activeTool === "brush" || activeTool === "eraser") return;

    setLiveStroke((prev) => {
      if (prev && prev.length >= 4) {
        appendPencilStroke(pointsToPathD(prev));
      }
      return null;
    });
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pointerRef.current?.pan) {
      pointerRef.current = null;
      setIsPanning(false);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      return;
    }

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    finishStroke();
  };

  const toggleTool = (tool: PreviewTool) => {
    setActiveTool((current) => (current === tool ? null : tool));
    finishStroke();
    if (tool !== "brush" && tool !== "eraser") setBrushHover(null);
  };

  const shapeFill = fillOverride ?? undefined;

  const previewCursor =
    isEditing && isPanning
      ? "cursor-grabbing"
      : isEditing && ctrlPan
        ? "cursor-grab"
        : isEditing && activeTool
          ? activeTool === "brush" || activeTool === "eraser"
            ? "cursor-none"
            : "cursor-crosshair"
          : "";

  return (
    <div
      className={`absolute top-3 left-3 z-20 flex flex-col rounded-lg border border-zinc-600 bg-zinc-900/95 shadow-xl overflow-hidden transition-all duration-200 ${
        isEditing ? "w-80 h-[26rem]" : "w-44 h-44"
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-zinc-700/80 px-2 py-1.5 pointer-events-auto">
        <span className="truncate text-[10px] font-mono text-zinc-400">
          {meta.id}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {isEditing && (
            <>
              <button
                type="button"
                className="rounded px-2 py-0.5 text-[10px] bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                title="Discard all changes and exit"
                onClick={cancelEdits}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded px-2 py-0.5 text-[10px] bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                title="Reset to how the path looked when you started editing"
                onClick={clearEdits}
              >
                Clear Edit
              </button>
            </>
          )}
          <button
            type="button"
            className={`rounded px-2 py-0.5 text-[10px] ${
              isEditing
                ? "bg-cyan-900 text-cyan-200 hover:bg-cyan-800"
                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
            onClick={() => {
              if (isEditing) {
                commitEdits();
                setActiveTool(null);
                setBrushHover(null);
                editBaselineRef.current = null;
                setIsEditing(false);
                return;
              }
              editBaselineRef.current = {
                d: getShapeSilhouetteD(shape) ?? "",
                paintLayers: shape.paintLayers
                  ? {
                      strokes: [...shape.paintLayers.strokes],
                      dots: [...shape.paintLayers.dots],
                    }
                  : undefined,
                fill: fillOverride,
              };
              setPathSegments(splitPathSegments(getShapeSilhouetteD(shape) ?? ""));
              const { strokes, dots } = fromPaintLayers(shape.paintLayers);
              setOverlayStrokes(strokes);
              setOverlayBrushDots(dots);
              setIsEditing(true);
            }}
          >
            {isEditing ? "Done" : "Edit path"}
          </button>
        </div>
      </div>

      <div
        ref={canvasWrapRef}
        className={`relative min-h-0 flex-1 flex ${isEditing ? "" : "pointer-events-none"}`}
      >
        {isEditing && (
          <div className="flex w-9 shrink-0 flex-col items-center justify-center gap-1.5 border-r border-zinc-700/80 bg-zinc-950/70 px-1 py-2 pointer-events-auto">
            <button
              type="button"
              className="rounded px-1 py-0.5 text-[9px] font-mono text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              title="Zoom in"
              onClick={() => applyZoomPercent(zoomPercent + 10)}
            >
              +
            </button>
            <input
              type="range"
              min={MIN_PREVIEW_ZOOM}
              max={MAX_PREVIEW_ZOOM}
              step={5}
              value={zoomPercent}
              onChange={(e) => applyZoomPercent(Number(e.target.value))}
              aria-label="Zoom"
              title="Zoom"
              className="h-28 w-4 cursor-pointer accent-cyan-500 [writing-mode:vertical-lr] [direction:rtl]"
            />
            <button
              type="button"
              className="rounded px-1 py-0.5 text-[9px] font-mono text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              title="Zoom out"
              onClick={() => applyZoomPercent(zoomPercent - 10)}
            >
              −
            </button>
            <button
              type="button"
              className="rounded px-1 py-0.5 text-[9px] font-mono text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              title="Reset zoom"
              onClick={() => setViewBox(basePreviewViewBox)}
            >
              {zoomPercent}%
            </button>
          </div>
        )}
        <div className="relative min-w-0 flex-1">
          <svg
            ref={svgRef}
            viewBox={formatViewBox(viewBox)}
            width="100%"
            height="100%"
            preserveAspectRatio="xMidYMid meet"
            className={`size-full select-none touch-none ${previewCursor}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerLeave}
          >
            <rect
              x={viewBox.x}
              y={viewBox.y}
              width={viewBox.width}
              height={viewBox.height}
              fill="#18181b"
            />
            <style dangerouslySetInnerHTML={{ __html: styleCss }} />
            <ShapePaintLayersGraphic
              layers={previewPaintLayers}
              className={shape.className}
              fillOverride={shapeFill}
            />
            {renderShapeGeometry(previewShape, {
              className: shape.className,
              fill: shapeFill,
              opacity: 1,
            })}
            {liveStroke && liveStroke.length >= 2 && (
              <FilledPathGeometry
                d={pointsToPathD(liveStroke)}
                fill={color}
                opacity={0.85}
                stroke="none"
              />
            )}
            {(activeTool === "brush" || activeTool === "eraser") && brushHover && (
              <circle
                cx={brushHover.x}
                cy={brushHover.y}
                r={activeTool === "eraser" ? ERASE_RADIUS : brushRadius}
                fill={activeTool === "eraser" ? "none" : color}
                fillOpacity={activeTool === "brush" && drawingRef.current ? 0.85 : activeTool === "brush" ? 0.35 : undefined}
                stroke={activeTool === "eraser" ? "#f87171" : BRUSH_POINTER_RING}
                strokeWidth={activeTool === "eraser" ? 2 : 1.5}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
          </svg>
          {isEditing && activeTool === "brush" && (
            <div
              className="pointer-events-auto absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md border border-zinc-600/80 bg-zinc-950/90 px-2 py-1 shadow-lg"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span
                className="shrink-0 rounded-full border border-zinc-600"
                style={{
                  width: Math.max(4, brushRadius * 2),
                  height: Math.max(4, brushRadius * 2),
                  backgroundColor: color,
                }}
                aria-hidden
              />
              <input
                type="range"
                min={MIN_BRUSH_RADIUS}
                max={MAX_BRUSH_RADIUS}
                step={1}
                value={brushRadius}
                onChange={(e) => setBrushRadius(Number(e.target.value))}
                aria-label="Brush size"
                title="Brush size"
                className="h-1.5 w-24 cursor-pointer accent-cyan-500"
              />
              <span className="w-4 shrink-0 text-center text-[9px] font-mono text-zinc-400">
                {brushRadius}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-zinc-700/80 px-2 py-1 text-[10px] font-mono text-zinc-500 truncate pointer-events-none">
        {meta.className}
        {fillOverride ? ` · ${fillOverride}` : ""}
      </div>

      {isEditing && (
        <>
          <div className="flex items-center border-t border-zinc-700 px-3 py-2 pointer-events-auto">
            <div className="flex flex-1 items-center justify-center gap-2">
              <button
                type="button"
                aria-label="Draw lines"
                aria-pressed={activeTool === "pencil"}
                title="Pencil — draw filled path shapes"
                className={`rounded p-1.5 ${
                  activeTool === "pencil"
                    ? "bg-cyan-900 text-cyan-200"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                }`}
                onClick={() => toggleTool("pencil")}
              >
                <Pencil className="size-3.5" strokeWidth={2.5} />
              </button>
              <button
                type="button"
                aria-label="Paint with brush"
                aria-pressed={activeTool === "brush"}
                title="Brush — paint filled circles"
                className={`rounded p-1.5 ${
                  activeTool === "brush"
                    ? "bg-cyan-900 text-cyan-200"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                }`}
                onClick={() => toggleTool("brush")}
              >
                <Brush className="size-3.5" strokeWidth={2.5} />
              </button>
              <button
                type="button"
                aria-label="Erase paint overlays"
                aria-pressed={activeTool === "eraser"}
                title="Eraser — remove brush strokes and lines"
                className={`rounded p-1.5 ${
                  activeTool === "eraser"
                    ? "bg-red-900 text-red-200"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                }`}
                onClick={() => toggleTool("eraser")}
              >
                <Eraser className="size-3.5" strokeWidth={2.5} />
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Pick color from canvas"
                aria-pressed={activeTool === "eyedropper"}
                title="Eyedropper — pick color"
                className={`rounded p-1.5 ${
                  activeTool === "eyedropper"
                    ? "bg-cyan-900 text-cyan-200"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                }`}
                onClick={() => toggleTool("eyedropper")}
              >
                <Pipette className="size-3.5" strokeWidth={2.5} />
              </button>
              <label
                className="flex items-center rounded bg-zinc-800 p-1 hover:bg-zinc-700 cursor-pointer"
                title="Fill / stroke color"
              >
                <span
                  className="size-4 rounded border border-zinc-600"
                  style={{ backgroundColor: color }}
                />
                <input
                  type="color"
                  value={color}
                  className="sr-only"
                  onChange={(e) => {
                    setColor(e.target.value);
                    onShapeChange(shape.id, { fill: e.target.value });
                  }}
                />
              </label>
            </div>
          </div>

          {shape.tag === "path" && (
            <div className="border-t border-zinc-700 p-2 pointer-events-auto">
              <div className="mb-1 flex items-center gap-1 text-[10px] text-zinc-500">
                <PencilLine className="size-3" />
                Path data (d)
              </div>
              <textarea
                value={pathDraft}
                onChange={(e) => setPathSegments(splitPathSegments(e.target.value))}
                onBlur={() => applyPathDraft(pathDraft)}
                spellCheck={false}
                className="h-16 w-full resize-none rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-[10px] text-zinc-300 focus:border-cyan-700 focus:outline-none"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
