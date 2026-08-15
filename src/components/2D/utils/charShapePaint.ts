import type { PathShape, ShapePaintLayers } from "@/components/2D/utils/charLabSvg";

export function splitPathSegments(d: string) {
  const trimmed = d.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/(?=[Mm])/).map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : [trimmed];
}

export function joinPathSegments(segments: string[]) {
  return segments.map((part) => part.trim()).filter(Boolean).join(" ");
}

/** Base fill silhouette — hand-drawn pencil/brush live in paintLayers. */
export function getShapeSilhouetteD(shape: PathShape): string | undefined {
  return shape.silhouetteD ?? shape.attrs.d;
}

export function hasPaintContent(layers?: ShapePaintLayers) {
  return !!layers?.strokes?.length || !!layers?.dots?.length;
}

function migrateShapeHandDrawToUnderlay(
  shape: PathShape,
  importedBaselineD?: string
): PathShape {
  const currentD = shape.attrs.d ?? "";
  const dots = [...(shape.paintLayers?.dots ?? [])];
  const strokes = [...(shape.paintLayers?.strokes ?? [])];
  const currentSegments = splitPathSegments(currentD);

  let silhouetteD = getShapeSilhouetteD(shape) ?? currentD;

  const baselineD = importedBaselineD?.trim() || shape.silhouetteD?.trim() || "";
  if (baselineD) {
    silhouetteD = baselineD;
    const baselineSegments = splitPathSegments(baselineD);
    if (currentSegments.length > baselineSegments.length) {
      const pencilSegments = currentSegments.slice(baselineSegments.length);
      for (const d of pencilSegments) {
        strokes.push({ d, color: "", filled: true });
      }
    }
  }

  return {
    ...shape,
    attrs: { ...shape.attrs, d: silhouetteD },
    silhouetteD,
    paintLayers: { strokes, dots },
  };
}

/** Keep manual pencil/brush in paintLayers; attrs.d holds the base silhouette only. */
export function migrateHandDrawToUnderlay(
  shapes: PathShape[],
  baselineById?: Map<string, string>
) {
  return shapes.map((shape) =>
    migrateShapeHandDrawToUnderlay(shape, baselineById?.get(shape.id))
  );
}
