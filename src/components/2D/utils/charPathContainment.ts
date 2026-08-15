type ShapeLike = {
  id: string;
  tag: string;
  className: string;
  x: number;
  y: number;
  attrs: { d?: string };
};

export type ContainedPath = {
  id: string;
  className: string;
  layer: "below" | "above";
};

const LINE_MIN_THICKNESS = 3;
const LINE_ASPECT_RATIO = 5;

export function pathIndex(id: string): number {
  return Number.parseInt(id.replace("path-", ""), 10);
}

export function isClosedShape(shape: ShapeLike): boolean {
  if (shape.tag === "polygon" || shape.tag === "rect") return true;
  if (shape.tag === "path" && shape.attrs.d) {
    return /[zZ]\s*$/.test(shape.attrs.d.trim());
  }
  return false;
}

export function classHasFill(styleCss: string, className: string): boolean {
  if (!className) return true;
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\.${escaped}\\s*\\{[^}]*\\bfill\\s*:\\s*([^;\\}]+)`, "i");
  const match = styleCss.match(re);
  if (!match) return true;
  return match[1].trim().toLowerCase() !== "none";
}

export function isLineLike(el: SVGGraphicsElement): boolean {
  const { width, height } = el.getBBox();
  if (width === 0 && height === 0) return true;
  const minDim = Math.min(width, height);
  const maxDim = Math.max(width, height);
  return minDim < LINE_MIN_THICKNESS && maxDim > minDim * LINE_ASPECT_RATIO;
}

function toElementLocalPoint(
  container: SVGGraphicsElement,
  svg: SVGSVGElement,
  x: number,
  y: number
) {
  const pt = svg.createSVGPoint();
  pt.x = x;
  pt.y = y;
  const base = container.transform?.baseVal?.consolidate();
  if (!base) return { x, y };
  const local = pt.matrixTransform(base.matrix.inverse());
  return { x: local.x, y: local.y };
}

export function isPointInFilledShape(
  container: SVGGeometryElement,
  svg: SVGSVGElement,
  x: number,
  y: number
): boolean {
  if (!("isPointInFill" in container)) return false;

  const local = toElementLocalPoint(container, svg, x, y);
  const pt = svg.createSVGPoint();
  pt.x = local.x;
  pt.y = local.y;
  return container.isPointInFill(pt);
}

export function isPointInLocalBBox(
  container: SVGGraphicsElement,
  svg: SVGSVGElement,
  x: number,
  y: number,
  margin = 2
): boolean {
  const local = toElementLocalPoint(container, svg, x, y);
  const bbox = container.getBBox();
  return (
    local.x >= bbox.x - margin &&
    local.x <= bbox.x + bbox.width + margin &&
    local.y >= bbox.y - margin &&
    local.y <= bbox.y + bbox.height + margin
  );
}

export function findContainedPaths(
  containerId: string,
  shapes: ShapeLike[],
  svg: SVGSVGElement,
  styleCss: string
): ContainedPath[] {
  const containerEl = svg.getElementById(containerId) as SVGGeometryElement | null;
  if (!containerEl) return [];

  const containerShape = shapes.find((shape) => shape.id === containerId);
  if (!containerShape || !isClosedShape(containerShape)) return [];
  if (!classHasFill(styleCss, containerShape.className)) return [];
  if (isLineLike(containerEl)) return [];

  const containerIdx = pathIndex(containerId);
  const results: ContainedPath[] = [];

  for (const shape of shapes) {
    if (shape.id === containerId) continue;
    if (!isClosedShape(shape)) continue;
    if (!classHasFill(styleCss, shape.className)) continue;

    const el = svg.getElementById(shape.id) as SVGGraphicsElement | null;
    if (!el) continue;
    if (isLineLike(el)) continue;
    if (!isPointInLocalBBox(containerEl, svg, shape.x, shape.y)) continue;
    if (!isPointInFilledShape(containerEl, svg, shape.x, shape.y)) continue;

    const idx = pathIndex(shape.id);
    results.push({
      id: shape.id,
      className: shape.className,
      layer: idx < containerIdx ? "below" : "above",
    });
  }

  return results.sort((a, b) => pathIndex(a.id) - pathIndex(b.id));
}
