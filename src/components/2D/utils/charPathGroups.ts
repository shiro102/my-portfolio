import defaultGroups from "@/components/2D/assets/hoshino-new/path-groups.json";

export const HOSHINO_GROUPS_STORAGE_KEY = "animation-lab-groups";

export const DEFAULT_HOSHINO_GROUP_NAMES = Object.keys(defaultGroups.groups);

/** Back → front paint order; index is the default order value (0 = lowest). */
export const DEFAULT_GROUP_PAINT_ORDER = [
  "hair-back",
  "leg-left",
  "leg-right",
  "skirt",
  "torso",
  "arm-left",
  "arm-right",
  "hair-front",
  "head",
  "hat",
  "detail",
] as const;

export function defaultGroupOrders(): Record<string, number> {
  return Object.fromEntries(
    DEFAULT_GROUP_PAINT_ORDER.map((name, index) => [name, index])
  );
}

export function mergeStoredGroupOrders(
  groupNames: string[],
  saved?: unknown
): Record<string, number> {
  const defaults = defaultGroupOrders();
  const next: Record<string, number> = {};
  let maxOrder = Math.max(0, ...Object.values(defaults));

  for (const name of groupNames) {
    if (saved && typeof saved === "object") {
      const raw = (saved as Record<string, unknown>)[name];
      if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
        next[name] = Math.floor(raw);
        maxOrder = Math.max(maxOrder, next[name]);
        continue;
      }
    }
    if (defaults[name] != null) {
      next[name] = defaults[name];
      maxOrder = Math.max(maxOrder, next[name]);
    } else {
      maxOrder += 1;
      next[name] = maxOrder;
    }
  }

  return next;
}

export function sortGroupNamesByOrder(
  groupNames: string[],
  groupOrder: Record<string, number>
): string[] {
  return [...groupNames].sort((a, b) => {
    const ao = groupOrder[a] ?? 0;
    const bo = groupOrder[b] ?? 0;
    if (ao !== bo) return ao - bo;
    return a.localeCompare(b);
  });
}

export function nextGroupOrderValue(groupOrder: Record<string, number>): number {
  if (!Object.keys(groupOrder).length) return 0;
  return Math.max(0, ...Object.values(groupOrder)) + 1;
}

/** Move legacy `hair` assignments into `hair-back`; ensure both hair layers exist. */
export function migrateLegacyHairGroup(
  groups: Record<string, string[]>
): Record<string, string[]> {
  const next: Record<string, string[]> = { ...groups };
  const legacy = next.hair ?? [];
  delete next.hair;
  next["hair-back"] = [...(next["hair-back"] ?? []), ...legacy];
  next["hair-front"] = next["hair-front"] ?? [];
  return next;
}

export function mergeStoredGroups(
  saved: unknown,
  templateGroups?: Record<string, string[]>
): Record<string, string[]> {
  const names = templateGroups
    ? Object.keys(templateGroups)
    : DEFAULT_HOSHINO_GROUP_NAMES;
  const merged: Record<string, string[]> = Object.fromEntries(
    names.map((name) => [name, [] as string[]])
  );

  if (saved && typeof saved === "object") {
    for (const [name, ids] of Object.entries(saved as Record<string, unknown>)) {
      if (Array.isArray(ids) && ids.every((id) => typeof id === "string")) {
        merged[name] = ids;
      }
    }
  }

  if (!templateGroups || names.includes("hair-back") || names.includes("hair")) {
    return migrateLegacyHairGroup(merged);
  }
  return merged;
}

export function readStoredGroups(): Record<string, string[]> {
  if (typeof window === "undefined") return defaultGroups.groups;

  try {
    const raw = localStorage.getItem(HOSHINO_GROUPS_STORAGE_KEY);
    if (!raw) return defaultGroups.groups;
    const parsed = JSON.parse(raw) as { groups?: unknown };
    return mergeStoredGroups(parsed.groups);
  } catch {
    return defaultGroups.groups;
  }
}
