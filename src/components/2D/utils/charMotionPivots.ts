type ManifestPoint = { x: number; y: number };

export function pivotPx(x: number, y: number) {
  return `${Math.round(x)}px ${Math.round(y)}px`;
}

export function computeCentroidPivot(
  ids: string[],
  manifestById: Map<string, ManifestPoint>
): string {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const id of ids) {
    const meta = manifestById.get(id);
    if (!meta) continue;
    sumX += meta.x;
    sumY += meta.y;
    count += 1;
  }
  if (count === 0) return pivotPx(1024, 1024);
  return pivotPx(sumX / count, sumY / count);
}

/** Shoulder joint: upper portion of the arm group, biased toward the torso. */
export function computeShoulderPivot(
  ids: string[],
  manifestById: Map<string, ManifestPoint>,
  side: "left" | "right"
): string {
  const points = ids
    .map((id) => manifestById.get(id))
    .filter((p): p is ManifestPoint => p != null);
  if (points.length === 0) return pivotPx(side === "left" ? 820 : 1220, 980);

  const ys = points.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const shoulderBand = minY + (maxY - minY) * 0.18;
  const shoulderPoints = points.filter((p) => p.y <= shoulderBand);
  const pool = shoulderPoints.length > 0 ? shoulderPoints : points;

  const sorted = [...pool].sort((a, b) =>
    side === "left" ? b.x - a.x : a.x - b.x
  );
  const sample = sorted.slice(0, Math.max(4, Math.ceil(sorted.length * 0.25)));
  const avgX = sample.reduce((s, p) => s + p.x, 0) / sample.length;
  const avgY = sample.reduce((s, p) => s + p.y, 0) / sample.length;
  return pivotPx(avgX, avgY);
}

/** Crown / upper-head anchor for hat stacking on the head group. */
export function computeHeadCrownPivot(
  ids: string[],
  manifestById: Map<string, ManifestPoint>
): string {
  const points = ids
    .map((id) => manifestById.get(id))
    .filter((p): p is ManifestPoint => p != null);
  if (points.length === 0) return pivotPx(1024, 580);

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const crownY = minY + (maxY - minY) * 0.22;
  return pivotPx(centerX, crownY);
}

/** Hip joint for leg rotation. */
export function computeHipPivot(
  ids: string[],
  manifestById: Map<string, ManifestPoint>,
  side: "left" | "right"
): string {
  const points = ids
    .map((id) => manifestById.get(id))
    .filter((p): p is ManifestPoint => p != null);
  if (points.length === 0) return pivotPx(side === "left" ? 920 : 1120, 1480);

  const ys = points.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const hipBand = minY + (maxY - minY) * 0.15;
  const hipPoints = points.filter((p) => p.y <= hipBand);
  const pool = hipPoints.length > 0 ? hipPoints : points;

  const sorted = [...pool].sort((a, b) =>
    side === "left" ? b.x - a.x : a.x - b.x
  );
  const sample = sorted.slice(0, Math.max(3, Math.ceil(sorted.length * 0.3)));
  const avgX = sample.reduce((s, p) => s + p.x, 0) / sample.length;
  const avgY = sample.reduce((s, p) => s + p.y, 0) / sample.length;
  return pivotPx(avgX, avgY);
}

/** Neck pivot for head rotation. */
export function computeNeckPivot(
  ids: string[],
  manifestById: Map<string, ManifestPoint>
): string {
  const points = ids
    .map((id) => manifestById.get(id))
    .filter((p): p is ManifestPoint => p != null);
  if (points.length === 0) return pivotPx(1024, 820);

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const neckY = maxY - (maxY - minY) * 0.12;
  return pivotPx(centerX, neckY);
}
