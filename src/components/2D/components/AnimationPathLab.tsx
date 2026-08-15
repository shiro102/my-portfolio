"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { type MotionValue, useMotionValue, useSpring, useTransform } from "framer-motion";
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import { ArmHingeGroup } from "@/components/2D/components/ArmHingeGroup";
import { PathPreviewPanel, DedupedPaintLayersGraphic } from "@/components/2D/components/PathPreviewPanel";
import { FilledPathGeometry } from "@/components/2D/components/FilledPathGeometry";
import { ChevronDown, Download, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import defaultPathsData from "@/components/2D/assets/hoshino-new/paths.json";
import defaultGroups from "@/components/2D/assets/hoshino-new/path-groups.json";
import {
  findContainedPaths,
  isPointInFilledShape,
  isPointInLocalBBox,
  pathIndex,
  type ContainedPath,
} from "@/components/2D/utils/charPathContainment";
import {
  mergeStoredGroupOrders,
  nextGroupOrderValue,
  sortGroupNamesByOrder,
} from "@/components/2D/utils/charPathGroups";
import {
  clipPolygonPointsForPart,
  expandShapesForLab,
  getBaseShapeId,
  makeSplitShapeId,
  migrateGroupsForSplit,
  migrateGroupsForUnsplit,
  pointInSplitPart,
  splitClipPathId,
  splitLineEndpoints,
  buildSplitDraft,
  type LabRenderable,
  type PathSplit,
  type SplitAxis,
} from "@/components/2D/utils/charPathSplits";
import {
  ARM_GROUP_NAMES,
  getArmPivotPathId,
  hasCustomPivotPoint,
  isArmGroup,
  isPointInArmPivotPath,
  resolveArmPivotOrigin,
  resolveArmPivotPoint,
  type ArmGroupName,
  type ArmPivotConfig,
} from "@/components/2D/utils/charPathPivots";
import {
  isLinearSpinMode,
  motionKindForGroup,
  peakRotateDeg,
  resolveGroupMotionConfig,
  resolveGroupMotionPivot,
  scrollSwayAtProgress,
  scrollSwayAtProgressLinear,
  type GroupMotionConfig,
  type GroupMotionDirection,
  type GroupMotionMode,
} from "@/components/2D/utils/charGroupMotion";
import {
  armBoneScaleFromRotation,
  armWidthScaleFromBoneScale,
} from "@/components/2D/utils/charArmMotion";
import {
  clearLabSession,
  BUILTIN_SVGS,
  DEFAULT_SVG_ID,
  DEFAULT_SVG_NAME,
  defaultGroupsForSvg,
  getBuiltinSvg,
  isBuiltinSvgId,
  manifestFromShapes,
  normalizeSvgName,
  parseSvgToPaths,
  readActiveSvgId,
  readLabSession,
  readSavedSvgs,
  writeActiveSvgId,
  writeDefaultShapeOverride,
  writeLabSession,
  writeSavedSvgs,
  applyDefaultShapeOverrides,
  parseMotionDriver,
  type MotionDriver,
  type PathDocument,
  type PathShape,
  type SavedSvg,
  type ShapePaintLayers,
} from "@/components/2D/utils/charLabSvg";
import {
  getShapeSilhouetteD,
  migrateHandDrawToUnderlay,
} from "@/components/2D/utils/charShapePaint";

type Shape = PathShape;
type Marquee = { x1: number; y1: number; x2: number; y2: number };
type ViewBox = { x: number; y: number; width: number; height: number };
type ReassignConfirm = {
  ids: string[];
  reassignments: { id: string; fromGroup: string }[];
};

function parseViewBox(raw: string): ViewBox {
  const [x, y, width, height] = raw.split(/\s+/).map(Number);
  return { x, y, width, height };
}

const MIN_VIEWBOX_SIZE = 80;

const DRAG_THRESHOLD_PX = 5;
const MARQUEE_MIN_SCREEN_HIT_PX = 12;
const MARQUEE_HIT_SLOP_PX = 2;

/** Virtual parent groups; subgroups keep their own path assignments. */
const GROUP_HIERARCHY = {
  top: ["hair-back", "hair-front", "head", "hat"],
  middle: ["torso", "arm-left", "arm-right"],
  bottom: ["skirt", "leg-left", "leg-right"],
} as const;

type ParentGroupName = keyof typeof GROUP_HIERARCHY;
const PARENT_GROUP_NAMES = Object.keys(GROUP_HIERARCHY) as ParentGroupName[];

const ALL_SUBGROUPS = new Set<string>(
  PARENT_GROUP_NAMES.flatMap((parent) => GROUP_HIERARCHY[parent])
);

function isSubgroup(name: string) {
  return ALL_SUBGROUPS.has(name);
}

function isParentGroup(name: string): name is ParentGroupName {
  return name in GROUP_HIERARCHY;
}

function subgroupPathCount(
  groups: Record<string, string[]>,
  parent: ParentGroupName
) {
  return GROUP_HIERARCHY[parent].reduce(
    (sum, name) => sum + (groups[name]?.length ?? 0),
    0
  );
}

function subgroupOptionsFor(
  groupNames: string[],
  parent: ParentGroupName
) {
  return GROUP_HIERARCHY[parent].filter((name) => groupNames.includes(name));
}

const SUBGROUP_INDENT = "\u2003\u2003";

function groupMatchesSolo(soloGroup: string | null, group: string | undefined) {
  if (!soloGroup) return true;
  if (isParentGroup(soloGroup)) {
    return !!group && (GROUP_HIERARCHY[soloGroup] as readonly string[]).includes(group);
  }
  return group === soloGroup;
}

function groupMatchesActive(activeGroup: string, group: string | undefined) {
  if (!group) return false;
  if (isParentGroup(activeGroup)) {
    return (GROUP_HIERARCHY[activeGroup] as readonly string[]).includes(group);
  }
  return group === activeGroup;
}

const LINEAR_SCROLL_GROUPS = new Set<string>(["leg-left", "leg-right"]);
const SCROLL_PREVIEW_SPRING = { stiffness: 500, damping: 28, mass: 0.25, restDelta: 0.0008 };

function scrollRotationForGroup(
  progress: number,
  name: string,
  config: GroupMotionConfig
) {
  if (isLinearSpinMode(config.mode) || LINEAR_SCROLL_GROUPS.has(name)) {
    return scrollSwayAtProgressLinear(progress, config);
  }
  return scrollSwayAtProgress(progress, config);
}

function LabScrollHinge({
  name,
  config,
  scrollProgress,
  cx,
  cy,
  children,
}: {
  name: string;
  config: GroupMotionConfig;
  scrollProgress: MotionValue<number>;
  cx: number;
  cy: number;
  children: React.ReactNode;
}) {
  const configRef = useRef(config);
  configRef.current = config;
  const nameRef = useRef(name);
  nameRef.current = name;

  const rotate = useTransform(scrollProgress, (t) =>
    scrollRotationForGroup(t, nameRef.current, configRef.current)
  );
  const isArm = isArmGroup(name);
  const scaleX = useTransform(rotate, (deg) =>
    isArm ? armBoneScaleFromRotation(deg) : 1
  );
  const scaleY = useTransform(scaleX, (sx) =>
    isArm ? armWidthScaleFromBoneScale(sx) : 1
  );

  return (
    <ArmHingeGroup
      cx={cx}
      cy={cy}
      originMode={config.mode === "spin-center" ? "fill-center" : "pivot"}
      liveMotion={isArm ? { rotate, scaleX, scaleY } : { rotate }}
    >
      {children}
    </ArmHingeGroup>
  );
}

const AnimationPathLab = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<HTMLDivElement>(null);
  const svgFileInputRef = useRef<HTMLInputElement>(null);
  const pointerRef = useRef<{
    startX: number;
    startY: number;
    marquee: boolean;
    pan: boolean;
    shiftKey: boolean;
    shapeId: string | null;
    svgX1: number;
    svgY1: number;
    svgX2: number;
    svgY2: number;
    viewBoxStart: ViewBox | null;
  } | null>(null);
  const [pathDocument, setPathDocument] = useState<PathDocument>(defaultPathsData);
  const [activeSvgId, setActiveSvgId] = useState(DEFAULT_SVG_ID);
  const [activeSvgName, setActiveSvgName] = useState(DEFAULT_SVG_NAME);
  const [savedSvgs, setSavedSvgs] = useState<SavedSvg[]>([]);
  const [svgLibraryHydrated, setSvgLibraryHydrated] = useState(false);
  const documentViewBox = useMemo(() => parseViewBox(pathDocument.viewBox), [pathDocument.viewBox]);
  const maxViewBoxSize = documentViewBox.width * 2;
  const viewBoxRef = useRef<ViewBox>(documentViewBox);
  const motionDriverRef = useRef<MotionDriver>("time");
  const testMotionRef = useRef(true);
  const scrollPreviewRef = useRef(0);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeGroup, setActiveGroup] = useState<string>("head");
  const [groups, setGroups] = useState<Record<string, string[]>>(defaultGroups.groups);
  const [groupOrder, setGroupOrder] = useState<Record<string, number>>({});
  const [groupsHydrated, setGroupsHydrated] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hoverBBox, setHoverBBox] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [pinnedPreviewId, setPinnedPreviewId] = useState<string | null>(null);
  const [pinnedPreviewBBox, setPinnedPreviewBBox] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [shapeFillOverrides, setShapeFillOverrides] = useState<Record<string, string>>({});
  const [soloGroup, setSoloGroup] = useState<string | null>(null);
  const [testMotion, setTestMotion] = useState(true);
  const [motionDriver, setMotionDriver] = useState<MotionDriver>("time");
  const [scrollPreview, setScrollPreview] = useState(0);
  const rawScrollProgress = useMotionValue(0);
  const scrollPreviewProgress = useSpring(rawScrollProgress, SCROLL_PREVIEW_SPRING);
  const [groupMotion, setGroupMotion] = useState<Record<string, GroupMotionConfig>>({});
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [nestedInside, setNestedInside] = useState<ContainedPath[] | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [showNewGroupForm, setShowNewGroupForm] = useState(false);
  const [svgSourceOpen, setSvgSourceOpen] = useState(true);
  const [groupToolsOpen, setGroupToolsOpen] = useState(false);
  const [showGroupPreview, setShowGroupPreview] = useState(false);
  const [groupPreviewBBox, setGroupPreviewBBox] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [reassignConfirm, setReassignConfirm] = useState<ReassignConfirm | null>(null);
  const [viewBox, setViewBox] = useState<ViewBox>(documentViewBox);
  const [ctrlPan, setCtrlPan] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [splits, setSplits] = useState<Record<string, PathSplit>>({});
  const [splitsHydrated, setSplitsHydrated] = useState(false);
  const [splitAxis, setSplitAxis] = useState<SplitAxis>("y");
  const [splitValue, setSplitValue] = useState(1024);
  const [splitPx, setSplitPx] = useState(1024);
  const [splitPy, setSplitPy] = useState(1024);
  const [splitPlacementMode, setSplitPlacementMode] = useState(false);
  const [showSplitPanel, setShowSplitPanel] = useState(false);
  const [pivotPlacementMode, setPivotPlacementMode] = useState(false);
  const [armPivots, setArmPivots] = useState<ArmPivotConfig>({});
  const [pivotsHydrated, setPivotsHydrated] = useState(false);

  const manifest = useMemo(() => manifestFromShapes(pathDocument.shapes), [pathDocument.shapes]);

  const manifestById = useMemo(
    () => new Map(manifest.map((entry) => [entry.id, entry])),
    [manifest]
  );

  const shapesById = useMemo(
    () => new Map(pathDocument.shapes.map((shape) => [shape.id, shape])),
    [pathDocument.shapes]
  );

  const previewId = pinnedPreviewId ?? hoverId;
  const previewShape = previewId ? shapesById.get(getBaseShapeId(previewId)) : undefined;
  const previewMeta = previewId ? manifestById.get(getBaseShapeId(previewId)) : undefined;
  const previewBBox = pinnedPreviewId ? pinnedPreviewBBox : hoverBBox;
  const previewViewBox = useMemo(() => {
    if (previewBBox && previewBBox.width > 0 && previewBBox.height > 0) {
      const pad = Math.max(12, Math.max(previewBBox.width, previewBBox.height) * 0.25);
      return `${previewBBox.x - pad} ${previewBBox.y - pad} ${previewBBox.width + pad * 2} ${previewBBox.height + pad * 2}`;
    }
    if (previewMeta) {
      return `${previewMeta.x - 100} ${previewMeta.y - 100} 200 200`;
    }
    return pathDocument.viewBox;
  }, [previewBBox, previewMeta, pathDocument.viewBox]);
  const previewFillOverride = previewShape
    ? shapeFillOverrides[getBaseShapeId(previewId!)]
    : undefined;

  const handlePreviewShapeChange = useCallback(
    (shapeId: string, updates: {
      attrs?: Partial<Shape["attrs"]>;
      fill?: string;
      paintLayers?: ShapePaintLayers;
      silhouetteD?: string;
      clearFill?: boolean;
    }) => {
      const baseId = getBaseShapeId(shapeId);
      if (updates.attrs || updates.paintLayers !== undefined || updates.silhouetteD !== undefined) {
        const applyShapePatch = (shape: Shape): Shape => {
          if (shape.id !== baseId) return shape;
          return {
            ...shape,
            ...(updates.attrs ? { attrs: { ...shape.attrs, ...updates.attrs } } : {}),
            ...(updates.silhouetteD !== undefined
              ? { silhouetteD: updates.silhouetteD }
              : {}),
            ...(updates.paintLayers !== undefined
              ? { paintLayers: updates.paintLayers }
              : {}),
          };
        };

        setPathDocument((prev) => {
          const shapes = prev.shapes.map(applyShapePatch);
          if (isBuiltinSvgId(activeSvgId)) {
            const patched = shapes.find((shape) => shape.id === baseId);
            if (patched && activeSvgId === DEFAULT_SVG_ID) {
              writeDefaultShapeOverride(baseId, {
                attrs: patched.attrs,
                silhouetteD: patched.silhouetteD,
                paintLayers: patched.paintLayers,
              });
            }
          }
          return { ...prev, shapes };
        });
        if (!isBuiltinSvgId(activeSvgId)) {
          setSavedSvgs((prev) => {
            const next = prev.map((entry) =>
              entry.id === activeSvgId
                ? {
                  ...entry,
                  document: {
                    ...entry.document,
                    shapes: entry.document.shapes.map(applyShapePatch),
                  },
                }
                : entry
            );
            writeSavedSvgs(next);
            return next;
          });
        }
      }
      if (updates.fill) {
        setShapeFillOverrides((prev) => ({ ...prev, [baseId]: updates.fill! }));
      }
      if (updates.clearFill) {
        setShapeFillOverrides((prev) => {
          const next = { ...prev };
          delete next[baseId];
          return next;
        });
      }
    },
    [activeSvgId]
  );

  const selectedList = useMemo(() => [...selectedIds], [selectedIds]);
  const primarySelected = selectedList[0] ?? null;
  const selectedBaseId = primarySelected ? getBaseShapeId(primarySelected) : null;
  const selectedMeta = selectedBaseId ? manifestById.get(selectedBaseId) : undefined;
  const selectedSplit = selectedBaseId ? splits[selectedBaseId] : undefined;

  const labItems = useMemo(
    () => expandShapesForLab(pathDocument.shapes, splits),
    [pathDocument.shapes, splits]
  );

  const pathToGroup = useMemo(() => {
    const map = new Map<string, string>();
    for (const [group, ids] of Object.entries(groups)) {
      for (const id of ids) map.set(id, group);
    }
    return map;
  }, [groups]);

  const selectedGroups = useMemo(() => {
    const names = new Set<string>();
    for (const id of selectedIds) {
      names.add(pathToGroup.get(id) ?? "unassigned");
    }
    return [...names];
  }, [pathToGroup, selectedIds]);

  const armBaseIds = useMemo(
    () => ({
      "arm-left": [...new Set((groups["arm-left"] ?? []).map(getBaseShapeId))],
      "arm-right": [...new Set((groups["arm-right"] ?? []).map(getBaseShapeId))],
    }),
    [groups]
  );

  const armPivotOrigins = useMemo(
    () => ({
      "arm-left": resolveArmPivotOrigin(
        "arm-left",
        armPivots["arm-left"],
        armBaseIds["arm-left"],
        manifestById,
        splits
      ),
      "arm-right": resolveArmPivotOrigin(
        "arm-right",
        armPivots["arm-right"],
        armBaseIds["arm-right"],
        manifestById,
        splits
      ),
    }),
    [armBaseIds, armPivots, manifestById, splits]
  );

  const activeMotionConfig = useMemo(
    () => resolveGroupMotionConfig(activeGroup, groupMotion[activeGroup]),
    [activeGroup, groupMotion]
  );

  const updateActiveGroupMotion = useCallback(
    (patch: Partial<GroupMotionConfig>) => {
      setGroupMotion((prev) => ({
        ...prev,
        [activeGroup]: resolveGroupMotionConfig(activeGroup, {
          ...prev[activeGroup],
          ...patch,
        }),
      }));
    },
    [activeGroup]
  );

  const resetActiveGroupMotion = useCallback(() => {
    setGroupMotion((prev) => {
      const next = { ...prev };
      delete next[activeGroup];
      return next;
    });
  }, [activeGroup]);

  const motionConfigFor = useCallback(
    (name: string) => resolveGroupMotionConfig(name, groupMotion[name]),
    [groupMotion]
  );

  const activeArmPivotEntry = isArmGroup(activeGroup) ? armPivots[activeGroup] : undefined;
  const activeArmPivotPathId = activeArmPivotEntry?.pathId;

  const pivotPathIds = useMemo(
    () =>
      new Set(
        ARM_GROUP_NAMES.map((group) => getArmPivotPathId(armPivots, group)).filter(
          (id): id is string => !!id
        )
      ),
    [armPivots]
  );

  const groupNames = useMemo(() => Object.keys(groups), [groups]);
  const lockedGroupNames = useMemo(
    () => new Set(Object.keys(defaultGroupsForSvg(activeSvgId))),
    [activeSvgId]
  );

  const paintableGroupNames = useMemo(() => {
    const names = groupNames.filter((name) => !isParentGroup(name));
    return sortGroupNamesByOrder(names, groupOrder);
  }, [groupNames, groupOrder]);

  const groupUsesMotion = useCallback(
    (name: string) => {
      if (!testMotion) return false;
      if (motionDriver === "scroll") return true;
      if (activeGroup === name) return true;
      if (isParentGroup(activeGroup)) {
        return (GROUP_HIERARCHY[activeGroup] as readonly string[]).includes(name);
      }
      return false;
    },
    [activeGroup, motionDriver, testMotion]
  );

  const setScrollProgress = useCallback(
    (value: number) => {
      const next = Math.min(1, Math.max(0, value));
      scrollPreviewRef.current = next;
      setScrollPreview(next);
      rawScrollProgress.set(next);
    },
    [rawScrollProgress]
  );

  const setGroupOrderValue = useCallback((name: string, raw: number) => {
    const value = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
    setGroupOrder((prev) => ({ ...prev, [name]: value }));
  }, []);

  const normalizeGroupName = (raw: string) =>
    raw
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9_-]/g, "");

  const handleActiveGroupChange = (group: string) => {
    setActiveGroup(group);
    setSelectedIds(new Set());
    setPinnedPreviewId(null);
    setPinnedPreviewBBox(null);
    setShapeFillOverrides({});
    setNestedInside(null);
    setPivotPlacementMode(false);
  };

  const addGroup = () => {
    const name = normalizeGroupName(newGroupName);
    if (!name) return;
    setGroups((prev) => (prev[name] ? prev : { ...prev, [name]: [] }));
    setGroupOrder((prev) => ({
      ...prev,
      [name]: prev[name] ?? nextGroupOrderValue(prev),
    }));
    handleActiveGroupChange(name);
    setNewGroupName("");
    setShowNewGroupForm(false);
  };

  const removeGroup = (name: string) => {
    if (lockedGroupNames.has(name)) return;
    setGroups((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    setGroupOrder((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    setActiveGroup((current) => (current === name ? Object.keys(groups).find((g) => g !== name) ?? "head" : current));
    setSoloGroup((current) => (current === name ? null : current));
  };

  const persistSession = useCallback(
    (
      svgId: string,
      nextGroups: Record<string, string[]>,
      nextGroupOrder: Record<string, number>,
      nextSplits: Record<string, PathSplit>,
      nextPivots: ArmPivotConfig,
      nextMotion: Record<string, GroupMotionConfig>,
      nextDriver: MotionDriver,
      viewBoxValue: string
    ) => {
      writeLabSession(
        svgId,
        {
          groups: nextGroups,
          groupOrder: nextGroupOrder,
          splits: nextSplits,
          pivots: nextPivots,
          motion: nextMotion,
          motionDriver: nextDriver,
        },
        viewBoxValue
      );
    },
    []
  );

  const applyLabSession = useCallback((svgId: string, document: PathDocument) => {
    const session = readLabSession(svgId);
    const nextViewBox = parseViewBox(document.viewBox);
    const baselineById =
      svgId === DEFAULT_SVG_ID
        ? new Map(
            (defaultPathsData as PathDocument).shapes.map((shape) => [
              shape.id,
              shape.attrs.d ?? "",
            ])
          )
        : undefined;
    const migrated = migrateHandDrawToUnderlay(document.shapes, baselineById);
    setPathDocument({
      ...document,
      shapes:
        svgId === DEFAULT_SVG_ID
          ? applyDefaultShapeOverrides(migrated)
          : migrated,
    });
    setGroups(session.groups);
    setGroupOrder(
      mergeStoredGroupOrders(Object.keys(session.groups), session.groupOrder)
    );
    setSplits(session.splits);
    setArmPivots(session.pivots);
    setGroupMotion(session.motion ?? {});
    setMotionDriver(parseMotionDriver(session.motionDriver, "scroll"));
    setViewBox(nextViewBox);
    viewBoxRef.current = nextViewBox;
    setActiveGroup(Object.keys(session.groups)[0] ?? "head");
    setSelectedIds(new Set());
    setPinnedPreviewId(null);
    setPinnedPreviewBBox(null);
    setShapeFillOverrides({});
    setNestedInside(null);
    setSoloGroup(null);
    setSplitPlacementMode(false);
    setPivotPlacementMode(false);
    setShowSplitPanel(false);
    setGroupsHydrated(true);
    setSplitsHydrated(true);
    setPivotsHydrated(true);
  }, []);

  const activateSvg = useCallback(
    (svgId: string, document: PathDocument, name: string) => {
      setActiveSvgId(svgId);
      setActiveSvgName(name);
      writeActiveSvgId(svgId);
      applyLabSession(svgId, document);
    },
    [applyLabSession]
  );

  useEffect(() => {
    const library = readSavedSvgs();
    setSavedSvgs(library);
    const storedId = readActiveSvgId();
    const builtin = getBuiltinSvg(storedId);
    if (builtin) {
      activateSvg(builtin.id, builtin.document, builtin.name);
    } else {
      const saved = library.find((entry) => entry.id === storedId);
      if (saved) {
        activateSvg(saved.id, saved.document, saved.name);
      } else {
        activateSvg(DEFAULT_SVG_ID, defaultPathsData, DEFAULT_SVG_NAME);
      }
    }
    setSvgLibraryHydrated(true);
  }, [activateSvg]);

  useEffect(() => {
    if (!groupsHydrated || !svgLibraryHydrated) return;
    persistSession(
      activeSvgId,
      groups,
      groupOrder,
      splits,
      armPivots,
      groupMotion,
      motionDriver,
      pathDocument.viewBox
    );
  }, [
    activeSvgId,
    armPivots,
    groupMotion,
    groupOrder,
    groups,
    groupsHydrated,
    motionDriver,
    pathDocument.viewBox,
    persistSession,
    splits,
    splitsHydrated,
    pivotsHydrated,
    svgLibraryHydrated,
  ]);

  useEffect(() => {
    if (selectedIds.size !== 1 || !selectedBaseId) {
      setSplitPlacementMode(false);
      setShowSplitPanel(false);
      return;
    }
    const existing = splits[selectedBaseId];
    const meta = manifestById.get(selectedBaseId);
    if (existing) {
      setSplitAxis(existing.axis);
      setSplitValue(existing.value);
      setSplitPx(existing.px ?? meta?.x ?? 1024);
      setSplitPy(existing.py ?? meta?.y ?? 1024);
    } else if (meta) {
      setSplitAxis("y");
      setSplitValue(meta.y);
      setSplitPx(meta.x);
      setSplitPy(meta.y);
    }
  }, [selectedBaseId, selectedIds.size, splits, manifestById]);

  const currentSplitDraft = useMemo(
    () => buildSplitDraft(splitAxis, splitValue, splitPx, splitPy),
    [splitAxis, splitValue, splitPx, splitPy]
  );

  useEffect(() => {
    viewBoxRef.current = viewBox;
  }, [viewBox]);

  motionDriverRef.current = motionDriver;
  testMotionRef.current = testMotion;
  scrollPreviewRef.current = scrollPreview;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      if (testMotionRef.current && motionDriverRef.current === "scroll" && !e.ctrlKey) {
        e.preventDefault();
        setScrollProgress(scrollPreviewRef.current + e.deltaY * 0.0012);
        return;
      }

      e.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;

      const current = viewBoxRef.current;
      const zoomFactor = e.deltaY < 0 ? 0.9 : 1.1;
      const newWidth = Math.min(
        maxViewBoxSize,
        Math.max(MIN_VIEWBOX_SIZE, current.width * zoomFactor)
      );
      const newHeight = newWidth * (current.height / current.width);

      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const svgPt = pt.matrixTransform(ctm.inverse());

      const rx = (svgPt.x - current.x) / current.width;
      const ry = (svgPt.y - current.y) / current.height;

      setViewBox({
        x: svgPt.x - rx * newWidth,
        y: svgPt.y - ry * newHeight,
        width: newWidth,
        height: newHeight,
      });
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [maxViewBoxSize, setScrollProgress]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Control" || e.repeat) return;
      setCtrlPan(true);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "Control") return;
      setCtrlPan(false);
    };

    const onBlur = () => {
      setCtrlPan(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    setNestedInside(null);
  }, [primarySelected]);

  const findNestedPaths = () => {
    const svg = svgRef.current;
    if (!svg || !selectedBaseId) return;
    setNestedInside(
      findContainedPaths(selectedBaseId, pathDocument.shapes, svg, pathDocument.styleCss)
    );
  };

  const selectNestedPaths = (includeContainer: boolean) => {
    if (!nestedInside?.length) return;
    const ids = nestedInside.map((entry) => entry.id);
    if (includeContainer && primarySelected) ids.unshift(primarySelected);
    setSelectedIds(new Set(ids));
  };

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

  const idsInMarquee = useCallback((box: Marquee) => {
    const svg = svgRef.current;
    if (!svg) return [];

    const minX = Math.min(box.x1, box.x2);
    const maxX = Math.max(box.x1, box.x2);
    const minY = Math.min(box.y1, box.y2);
    const maxY = Math.max(box.y1, box.y2);

    const svgCtm = svg.getScreenCTM();
    if (!svgCtm) return [];

    const svgToClient = (sx: number, sy: number) => {
      const pt = svg.createSVGPoint();
      pt.x = sx;
      pt.y = sy;
      return pt.matrixTransform(svgCtm);
    };

    const marqueeCorners = [
      svgToClient(minX, minY),
      svgToClient(maxX, minY),
      svgToClient(minX, maxY),
      svgToClient(maxX, maxY),
    ];
    const marqueeRect = {
      left: Math.min(...marqueeCorners.map((pt) => pt.x)) - MARQUEE_HIT_SLOP_PX,
      right: Math.max(...marqueeCorners.map((pt) => pt.x)) + MARQUEE_HIT_SLOP_PX,
      top: Math.min(...marqueeCorners.map((pt) => pt.y)) - MARQUEE_HIT_SLOP_PX,
      bottom: Math.max(...marqueeCorners.map((pt) => pt.y)) + MARQUEE_HIT_SLOP_PX,
    };

    const hits: string[] = [];
    for (const item of labItems) {
      const el = svg.getElementById(item.id);
      const { shape } = item;

      const centerInMarquee =
        shape.x >= minX && shape.x <= maxX && shape.y >= minY && shape.y <= maxY;
      if (centerInMarquee) {
        if (
          !item.part ||
          !item.split ||
          pointInSplitPart(shape.x, shape.y, item.split, item.part)
        ) {
          hits.push(item.id);
          continue;
        }
      }

      if (!el) continue;

      const rect = el.getBoundingClientRect();
      const isTiny =
        rect.width < MARQUEE_MIN_SCREEN_HIT_PX || rect.height < MARQUEE_MIN_SCREEN_HIT_PX;
      if (!isTiny) continue;

      const padX = Math.max(MARQUEE_HIT_SLOP_PX, (MARQUEE_MIN_SCREEN_HIT_PX - rect.width) / 2);
      const padY = Math.max(MARQUEE_HIT_SLOP_PX, (MARQUEE_MIN_SCREEN_HIT_PX - rect.height) / 2);
      const shapeRect = {
        left: rect.left - padX,
        right: rect.right + padX,
        top: rect.top - padY,
        bottom: rect.bottom + padY,
      };

      const bboxHit =
        shapeRect.right >= marqueeRect.left &&
        shapeRect.left <= marqueeRect.right &&
        shapeRect.bottom >= marqueeRect.top &&
        shapeRect.top <= marqueeRect.bottom;

      if (bboxHit) hits.push(item.id);
    }
    return hits;
  }, [labItems]);

  const assignIds = (ids: Iterable<string>) => {
    const idList = [...ids];
    if (!idList.length) return;
    setGroups((prev) => {
      const next: Record<string, string[]> = {};
      const idSet = new Set(idList);
      for (const [name, groupIds] of Object.entries(prev)) {
        next[name] = groupIds.filter((id) => !idSet.has(id));
      }
      next[activeGroup] = [...new Set([...(next[activeGroup] ?? []), ...idList])];
      return next;
    });
    setSelectedIds(new Set());
    setNestedInside(null);
  };

  const unassignIds = (ids: Iterable<string>) => {
    const idSet = new Set(ids);
    if (!idSet.size) return;
    setGroups((prev) => {
      const next: Record<string, string[]> = {};
      for (const [name, groupIds] of Object.entries(prev)) {
        next[name] = groupIds.filter((id) => !idSet.has(id));
      }
      return next;
    });
  };

  const assignSelected = () => {
    const idList = [...selectedIds];
    if (!idList.length) return;

    if (isParentGroup(activeGroup)) {
      toast("Pick a subgroup", {
        description: `Assign paths to a ${activeGroup} child group — not the parent.`,
      });
      return;
    }

    const reassignments = idList.flatMap((id) => {
      const fromGroup = pathToGroup.get(id);
      if (!fromGroup || fromGroup === activeGroup) return [];
      return [{ id, fromGroup }];
    });

    if (reassignments.length) {
      setReassignConfirm({ ids: idList, reassignments });
      return;
    }

    assignIds(idList);
  };

  const confirmReassign = () => {
    if (!reassignConfirm) return;
    assignIds(reassignConfirm.ids);
    setReassignConfirm(null);
  };
  const removeSelected = () => unassignIds(selectedIds);

  const exportJson = async () => {
    const payload = {
      viewBox: pathDocument.viewBox,
      groups,
      groupOrder,
      splits,
      pivots: armPivots,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      toast("Groups JSON copied", {
        description: `${Object.keys(groups).length} groups, ${Object.keys(splits).length} splits, ${Object.keys(armPivots).length} pivots copied`,
        style: {
          color: "#03992b",
        },
      });
    } catch {
      toast.error("Copy failed", {
        description: "Could not write to clipboard",
      });
    }
  };

  const resetGroups = () => {
    const defaults = defaultGroupsForSvg(activeSvgId);
    setGroups(defaults);
    setGroupOrder(mergeStoredGroupOrders(Object.keys(defaults)));
    setSplits({});
    setArmPivots({});
    setActiveGroup(Object.keys(defaults)[0] ?? "head");
    setSoloGroup(null);
    setSplitPlacementMode(false);
    setPivotPlacementMode(false);
    clearLabSession(activeSvgId, pathDocument.viewBox);
  };

  const handleSvgFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      const document = parseSvgToPaths(text);
      const name = normalizeSvgName(file.name);
      const entry: SavedSvg = {
        id: crypto.randomUUID(),
        name,
        savedAt: new Date().toISOString(),
        document,
      };
      const nextLibrary = [...savedSvgs, entry];
      setSavedSvgs(nextLibrary);
      writeSavedSvgs(nextLibrary);
      activateSvg(entry.id, document, name);
      toast("SVG added", {
        description: `${name} — ${document.shapes.length} paths indexed`,
      });
    } catch (error) {
      toast.error("Could not load SVG", {
        description: error instanceof Error ? error.message : "Invalid SVG file",
      });
    }
  };

  const handleSavedSvgChange = (svgId: string) => {
    if (svgId === activeSvgId) return;
    const builtin = getBuiltinSvg(svgId);
    if (builtin) {
      activateSvg(builtin.id, builtin.document, builtin.name);
      return;
    }
    const saved = savedSvgs.find((entry) => entry.id === svgId);
    if (!saved) return;
    activateSvg(saved.id, saved.document, saved.name);
  };

  const deleteSavedSvg = (svgId: string) => {
    const nextLibrary = savedSvgs.filter((entry) => entry.id !== svgId);
    setSavedSvgs(nextLibrary);
    writeSavedSvgs(nextLibrary);
    if (activeSvgId === svgId) {
      activateSvg(DEFAULT_SVG_ID, defaultPathsData, DEFAULT_SVG_NAME);
    }
    toast("SVG removed", { description: "Deleted from saved library" });
  };

  const downloadBuiltinDump = () => {
    const payload = {
      builtinDocument: pathDocument,
      builtinSession: {
        groups,
        groupOrder,
        splits,
        pivots: armPivots,
        motion: groupMotion,
        motionDriver,
      },
    };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lab-localStorage-dump.json";
    link.click();
    URL.revokeObjectURL(url);
    toast("Built-in dump downloaded", {
      description: "Save it as scripts/lab-localStorage-dump.json, then run the export script.",
    });
  };

  const setArmPivotPath = (group: ArmGroupName, pathId: string) => {
    setArmPivots((prev) => ({ ...prev, [group]: { pathId } }));
    setPivotPlacementMode(false);
    toast("Pivot assigned", { description: `${group} rotates at ${pathId}` });
  };

  const clearArmPivotPath = (group: ArmGroupName) => {
    setArmPivots((prev) => {
      const next = { ...prev };
      delete next[group];
      return next;
    });
    setPivotPlacementMode(false);
    toast("Pivot cleared", { description: `${group} uses auto shoulder pivot` });
  };

  const setArmPivotPoint = (group: ArmGroupName, x: number, y: number) => {
    setArmPivots((prev) => {
      const entry = prev[group];
      if (!entry?.pathId) return prev;
      return { ...prev, [group]: { ...entry, x, y } };
    });
  };

  const clearArmPivotCustomPoint = (group: ArmGroupName) => {
    setArmPivots((prev) => {
      const entry = prev[group];
      if (!entry?.pathId) return prev;
      return { ...prev, [group]: { pathId: entry.pathId } };
    });
    toast("Hinge reset", { description: "Using default point on pivot path" });
  };

  const beginPivotPlacement = () => {
    if (!isArmGroup(activeGroup) || !activeArmPivotPathId) return;
    setSplitPlacementMode(false);
    setPivotPlacementMode(true);
    toast("Pick hinge point", {
      description: `Click inside ${activeArmPivotPathId} to place the crosshair`,
    });
  };

  const applySplit = (baseId: string) => {
    const split = buildSplitDraft(splitAxis, splitValue, splitPx, splitPy);
    setSplits((prev) => ({ ...prev, [baseId]: split }));
    setGroups((prev) => migrateGroupsForSplit(prev, baseId));
    setSelectedIds(new Set([makeSplitShapeId(baseId, "a"), makeSplitShapeId(baseId, "b")]));
    setSplitPlacementMode(false);
    toast("Path split", {
      description: `${baseId} → ${makeSplitShapeId(baseId, "a")}, ${makeSplitShapeId(baseId, "b")}`,
    });
  };

  const removeSplit = (baseId: string) => {
    setSplits((prev) => {
      const next = { ...prev };
      delete next[baseId];
      return next;
    });
    setGroups((prev) => migrateGroupsForUnsplit(prev, baseId));
    setSelectedIds(new Set([baseId]));
    toast("Split removed", { description: `${baseId} is a single path again` });
  };

  const updateExistingSplit = (baseId: string, draft: PathSplit) => {
    setSplitAxis(draft.axis);
    setSplitValue(draft.value);
    if (draft.px != null) setSplitPx(draft.px);
    if (draft.py != null) setSplitPy(draft.py);
    setSplits((prev) => ({ ...prev, [baseId]: draft }));
  };

  const suggestByY = () => {
    setGroups((prev) => {
      const next: Record<string, string[]> = Object.fromEntries(
        Object.keys(prev).map((g) => [g, []])
      );
      for (const shape of pathDocument.shapes) {
        const y = shape.y;
        let group = "detail";
        if (y < 380) group = "hat";
        else if (y < 620) group = "head";
        else if (y < 820) group = "hair-back";
        else if (y < 1180) group = "torso";
        else if (y < 1380) group = "skirt";
        else if (shape.x < 1024) group = "leg-left";
        else group = "leg-right";
        if (next[group]) next[group].push(shape.id);
      }
      return next;
    });
  };

  const shapeBBoxArea = (el: SVGGraphicsElement) => {
    try {
      const { width, height } = el.getBBox();
      return width * height;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  };

  const shapeContainsPoint = (
    el: SVGGraphicsElement,
    svg: SVGSVGElement,
    x: number,
    y: number
  ) => {
    if (el instanceof SVGGeometryElement && "isPointInFill" in el) {
      if (isPointInFilledShape(el, svg, x, y)) return true;
    }
    return isPointInLocalBBox(el, svg, x, y);
  };

  const resolveShapeIdFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return null;

      const { x, y } = clientToSvg(clientX, clientY);
      let bestId: string | null = null;
      let bestArea = Number.POSITIVE_INFINITY;
      let bestIndex = -1;

      for (let i = labItems.length - 1; i >= 0; i--) {
        const item = labItems[i];
        const group = pathToGroup.get(item.id);
        if (!groupMatchesSolo(soloGroup, group)) continue;

        if (item.split && item.part && !pointInSplitPart(x, y, item.split, item.part)) {
          continue;
        }

        const el = svg.getElementById(item.id);
        if (!el || !(el instanceof SVGGraphicsElement)) continue;
        if (!shapeContainsPoint(el, svg, x, y)) continue;

        const area = shapeBBoxArea(el);
        const index = pathIndex(item.shape.id);
        if (area < bestArea || (area === bestArea && index > bestIndex)) {
          bestArea = area;
          bestIndex = index;
          bestId = item.id;
        }
      }

      return bestId;
    },
    [clientToSvg, labItems, pathToGroup, soloGroup]
  );

  const updateHoverFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      const shapeId = resolveShapeIdFromPointer(clientX, clientY);
      setHoverId(shapeId);
      if (!shapeId || !svg) {
        setHoverBBox(null);
        return;
      }
      const el = svg.getElementById(shapeId);
      if (!el || !(el instanceof SVGGraphicsElement)) {
        setHoverBBox(null);
        return;
      }
      try {
        setHoverBBox(el.getBBox());
      } catch {
        setHoverBBox(null);
      }
    },
    [resolveShapeIdFromPointer]
  );

  const pinPreviewForShape = useCallback((shapeId: string | null) => {
    if (!shapeId) {
      setPinnedPreviewId(null);
      setPinnedPreviewBBox(null);
      return;
    }
    const svg = svgRef.current;
    setPinnedPreviewId(shapeId);
    if (!svg) {
      setPinnedPreviewBBox(null);
      return;
    }
    const el = svg.getElementById(shapeId);
    if (!el || !(el instanceof SVGGraphicsElement)) {
      setPinnedPreviewBBox(null);
      return;
    }
    try {
      setPinnedPreviewBBox(el.getBBox());
    } catch {
      setPinnedPreviewBBox(null);
    }
  }, []);

  const handleShapeClick = (shapeId: string, shiftKey: boolean) => {
    pinPreviewForShape(shapeId);
    setSelectedIds((prev) => {
      if (shiftKey) {
        const next = new Set(prev);
        if (next.has(shapeId)) next.delete(shapeId);
        else next.add(shapeId);
        return next;
      }
      return new Set([shapeId]);
    });
  };

  const beginMarquee = (clientX: number, clientY: number) => {
    const pt = clientToSvg(clientX, clientY);
    if (!pointerRef.current) return;
    pointerRef.current.svgX1 = pt.x;
    pointerRef.current.svgY1 = pt.y;
    pointerRef.current.svgX2 = pt.x;
    pointerRef.current.svgY2 = pt.y;
    setMarquee({ x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
  };

  const resetViewBox = () => setViewBox(documentViewBox);

  const zoomPercent = Math.round((documentViewBox.width / viewBox.width) * 100);
  const isDefaultView =
    Math.abs(viewBox.width - documentViewBox.width) < 0.5 &&
    Math.abs(viewBox.x - documentViewBox.x) < 0.5 &&
    Math.abs(viewBox.y - documentViewBox.y) < 0.5;
  const canvasCursor = pivotPlacementMode
    ? "cursor-crosshair"
    : splitPlacementMode
      ? "cursor-crosshair"
      : isPanning
        ? "cursor-grabbing"
        : ctrlPan
          ? "cursor-grab"
          : "cursor-crosshair";

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && !(e.target as Element).closest("svg")) return;

    const isPan = e.button === 1 || (e.button === 0 && e.ctrlKey);

    if (isPan) {
      e.preventDefault();
      setIsPanning(true);
      pointerRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        marquee: false,
        pan: true,
        shiftKey: false,
        shapeId: null,
        svgX1: 0,
        svgY1: 0,
        svgX2: 0,
        svgY2: 0,
        viewBoxStart: { ...viewBox },
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (e.button !== 0) return;
    const shapeId = resolveShapeIdFromPointer(e.clientX, e.clientY);

    pointerRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      marquee: false,
      pan: false,
      shiftKey: e.shiftKey,
      shapeId,
      svgX1: 0,
      svgY1: 0,
      svgX2: 0,
      svgY2: 0,
      viewBoxStart: null,
    };

    if (shapeId) return;

    beginMarquee(e.clientX, e.clientY);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
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

    if (!drag?.marquee) {
      updateHoverFromPointer(e.clientX, e.clientY);
    }

    if (!drag) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.marquee && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
      drag.marquee = true;
      beginMarquee(drag.startX, drag.startY);
      interactionRef.current?.setPointerCapture(e.pointerId);
    }

    if (drag.marquee) {
      const pt = clientToSvg(e.clientX, e.clientY);
      drag.svgX2 = pt.x;
      drag.svgY2 = pt.y;
      setMarquee({ x1: drag.svgX1, y1: drag.svgY1, x2: pt.x, y2: pt.y });
    }
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = pointerRef.current;
    if (!drag) return;

    if (drag.pan) {
      pointerRef.current = null;
      setIsPanning(false);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      return;
    }

    if (drag.marquee) {
      const hitIds = idsInMarquee({
        x1: drag.svgX1,
        y1: drag.svgY1,
        x2: drag.svgX2,
        y2: drag.svgY2,
      });
      setSelectedIds((prev) =>
        drag.shiftKey ? new Set([...prev, ...hitIds]) : new Set(hitIds)
      );
    } else if (splitPlacementMode && selectedBaseId) {
      const pt = clientToSvg(e.clientX, e.clientY);
      if (splitAxis === "angle") {
        const draft = buildSplitDraft(splitAxis, splitValue, pt.x, pt.y);
        if (selectedSplit) {
          updateExistingSplit(selectedBaseId, draft);
        } else {
          setSplitPx(pt.x);
          setSplitPy(pt.y);
        }
      } else {
        const value = splitAxis === "y" ? pt.y : pt.x;
        const draft = buildSplitDraft(splitAxis, value, splitPx, splitPy);
        if (selectedSplit) {
          updateExistingSplit(selectedBaseId, { ...draft, value });
        } else {
          setSplitValue(value);
        }
      }
      setSplitPlacementMode(false);
    } else if (
      pivotPlacementMode &&
      isArmGroup(activeGroup) &&
      activeArmPivotPathId
    ) {
      const svg = svgRef.current;
      const pt = clientToSvg(e.clientX, e.clientY);
      if (
        svg &&
        isPointInArmPivotPath(svg, activeArmPivotPathId, pt.x, pt.y, splits)
      ) {
        setArmPivotPoint(activeGroup, pt.x, pt.y);
        toast("Hinge placed", {
          description: `${Math.round(pt.x)}, ${Math.round(pt.y)}`,
        });
      } else {
        toast.error("Outside pivot path", {
          description: "Click inside the cyan pivot path",
        });
      }
      setPivotPlacementMode(false);
    } else if (drag.shapeId && !drag.marquee) {
      handleShapeClick(drag.shapeId, drag.shiftKey);
    } else if (!drag.shapeId && !drag.marquee) {
      // Background click (not shape, not drag) — clear chosen selection
      if (!drag.shiftKey) {
        setSelectedIds(new Set());
        pinPreviewForShape(null);
      }
    }

    pointerRef.current = null;
    setMarquee(null);
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setHoverId(null);
      setHoverBBox(null);
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const renderShapeGeometry = (
    shape: Shape,
    props: Record<string, unknown>
  ) => {
    const { attrs } = shape;
    const silhouetteD = getShapeSilhouetteD(shape);
    if (shape.tag === "path" && silhouetteD) {
      return (
        <FilledPathGeometry
          d={silhouetteD}
          transform={attrs.transform}
          fillRule={attrs.fillRule as ComponentProps<"path">["fillRule"]}
          {...(props as ComponentProps<"path">)}
        />
      );
    }
    if (shape.tag === "polygon" && attrs.points) {
      return <polygon points={attrs.points} transform={attrs.transform} {...props} />;
    }
    if (shape.tag === "rect" && attrs.x != null) {
      return (
        <rect
          x={attrs.x}
          y={attrs.y}
          width={attrs.width}
          height={attrs.height}
          transform={attrs.transform}
          {...props}
        />
      );
    }
    return null;
  };

  const renderLabItem = (item: LabRenderable<Shape>) => {
    const { id, shape, part, split } = item;
    const group = pathToGroup.get(id);
    const isSelected = selectedIds.has(id);
    const isHover = hoverId === id;
    const dimmed = !groupMatchesSolo(soloGroup, group);
    const unassigned = !group;
    const inactiveAssigned = !dimmed && !!group && !groupMatchesActive(activeGroup, group);

    const siblingSplitId =
      part && split ? makeSplitShapeId(shape.id, part === "a" ? "b" : "a") : null;
    const siblingAlsoUnassigned =
      !!siblingSplitId && !pathToGroup.get(siblingSplitId);
    /** Both halves still unassigned — render solid like the original unsplit path. */
    const solidSplitPair = unassigned && !!part && siblingAlsoUnassigned;

    const baseOpacity = solidSplitPair
      ? 1
      : dimmed
        ? 0.12
        : inactiveAssigned || unassigned
          ? 0.55
          : 1;
    const isAssignedSelected = isSelected && !!group;
    const isPivotPath = pivotPathIds.has(id);
    const isPivotPlacementTarget =
      pivotPlacementMode && isArmGroup(activeGroup) && id === activeArmPivotPathId;

    const clipId = part && split ? splitClipPathId(shape.id, part) : undefined;
    const highlightStroke = isPivotPlacementTarget
      ? "#fbbf24"
      : isPivotPath
        ? "#22d3ee"
        : isHover
          ? "#f472b6"
          : null;

    const base = renderShapeGeometry(shape, {
      id,
      className: shape.className,
      fill: shapeFillOverrides[shape.id],
      opacity: baseOpacity,
      ...(highlightStroke
        ? {
            stroke: highlightStroke,
            strokeWidth: isPivotPlacementTarget ? 6 : isPivotPath ? 5 : 4,
            vectorEffect: "non-scaling-stroke" as const,
          }
        : {}),
      filter: isSelected && !group ? "url(#hoshino-selected-brighten)" : undefined,
      clipPath: clipId ? `url(#${clipId})` : undefined,
      style: { cursor: "pointer" as const, pointerEvents: "all" as const },
    });

    if (!base) return null;

    if (!isSelected) {
      return (
        <g key={id}>
          {base}
        </g>
      );
    }

    const tint = renderShapeGeometry(shape, {
      fill: isAssignedSelected ? "#ff9585" : "#ffb638",
      stroke: "none",
      opacity: isAssignedSelected ? 0.50 : 0.42,
      pointerEvents: "none",
      clipPath: clipId ? `url(#${clipId})` : undefined,
      style: isAssignedSelected
        ? { pointerEvents: "none" }
        : { mixBlendMode: "multiply", pointerEvents: "none" },
    });

    return (
      <g key={id}>
        {isAssignedSelected ? (
          <>
            {base}
            {tint}
          </>
        ) : (
          <>
            {tint}
            {base}
          </>
        )}
      </g>
    );
  };

  const groupedShapes = useMemo(() => {
    const byGroup = new Map<string, LabRenderable<Shape>[]>();
    for (const name of groupNames) byGroup.set(name, []);
    const unassigned: LabRenderable<Shape>[] = [];

    for (const item of labItems) {
      const group = pathToGroup.get(item.id);
      if (group && byGroup.has(group)) byGroup.get(group)!.push(item);
      else unassigned.push(item);
    }
    return { byGroup, unassigned };
  }, [labItems, pathToGroup, groupNames]);

  const activeGroupShapes = useMemo(() => {
    if (isParentGroup(activeGroup)) {
      return GROUP_HIERARCHY[activeGroup].flatMap(
        (name) => groupedShapes.byGroup.get(name) ?? []
      );
    }
    return groupedShapes.byGroup.get(activeGroup) ?? [];
  }, [groupedShapes, activeGroup]);

  const activeGroupShapeRevision = useMemo(
    () =>
      activeGroupShapes
        .map(
          (item) =>
            `${item.id}:${item.shape.attrs.d ?? ""}:${item.shape.attrs.points ?? ""}:${JSON.stringify(item.shape.paintLayers ?? null)}:${shapeFillOverrides[item.shape.id] ?? ""}`
        )
        .join("|"),
    [activeGroupShapes, shapeFillOverrides]
  );

  useLayoutEffect(() => {
    if (!showGroupPreview || !activeGroupShapes.length) {
      setGroupPreviewBBox(null);
      return;
    }

    const svg = svgRef.current;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const item of activeGroupShapes) {
      const el = svg?.getElementById(item.id);
      if (el) {
        try {
          const bb = (el as SVGGraphicsElement).getBBox();
          minX = Math.min(minX, bb.x);
          minY = Math.min(minY, bb.y);
          maxX = Math.max(maxX, bb.x + bb.width);
          maxY = Math.max(maxY, bb.y + bb.height);
          continue;
        } catch {
          // fall through to manifest estimate
        }
      }

      const meta = manifestById.get(item.shape.id);
      if (!meta) continue;
      minX = Math.min(minX, meta.x - 80);
      minY = Math.min(minY, meta.y - 80);
      maxX = Math.max(maxX, meta.x + 80);
      maxY = Math.max(maxY, meta.y + 80);
    }

    if (minX === Number.POSITIVE_INFINITY) {
      setGroupPreviewBBox(null);
      return;
    }

    setGroupPreviewBBox({
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    });
  }, [
    showGroupPreview,
    activeGroupShapes,
    activeGroupShapeRevision,
    testMotion,
    manifestById,
  ]);

  const groupPreviewViewBox = useMemo(() => {
    if (groupPreviewBBox && groupPreviewBBox.width > 0 && groupPreviewBBox.height > 0) {
      const pad = Math.max(16, Math.max(groupPreviewBBox.width, groupPreviewBBox.height) * 0.12);
      return `${groupPreviewBBox.x - pad} ${groupPreviewBBox.y - pad} ${groupPreviewBBox.width + pad * 2} ${groupPreviewBBox.height + pad * 2}`;
    }
    return pathDocument.viewBox;
  }, [groupPreviewBBox, pathDocument.viewBox]);

  const groupPreviewBounds = useMemo(() => {
    const [x, y, w, h] = groupPreviewViewBox.split(" ").map(Number);
    return { x, y, w, h };
  }, [groupPreviewViewBox]);

  const renderPivotMarker = (
    key: string,
    pt: { x: number; y: number },
    { assigned = false, active = false }: { assigned?: boolean; active?: boolean } = {}
  ) => (
    <g key={key} pointerEvents="none">
      <line
        x1={pt.x - 18}
        y1={pt.y}
        x2={pt.x + 18}
        y2={pt.y}
        stroke={active ? "#fbbf24" : "#22d3ee"}
        strokeWidth={active ? 3 : 2.5}
      />
      <line
        x1={pt.x}
        y1={pt.y - 18}
        x2={pt.x}
        y2={pt.y + 18}
        stroke={active ? "#fbbf24" : "#22d3ee"}
        strokeWidth={active ? 3 : 2.5}
      />
      <circle
        cx={pt.x}
        cy={pt.y}
        r={16}
        fill="none"
        stroke={active ? "#fbbf24" : "#22d3ee"}
        strokeWidth={active ? 3 : 2.5}
        strokeDasharray={assigned ? "4 3" : "2 2"}
      />
    </g>
  );

  const renderGroupPaint = (items: LabRenderable<Shape>[]) => (
    <DedupedPaintLayersGraphic
      items={items.map((item) => ({
        baseId: getBaseShapeId(item.id),
        paintLayers: item.shape.paintLayers,
        className: item.shape.className,
        fillOverride: shapeFillOverrides[item.shape.id],
      }))}
    />
  );

  type ScenePass = "paint" | "geometry";

  const renderGroupBlock = (
    name: string,
    items: LabRenderable<Shape>[],
    {
      motion = testMotion && activeGroup === name,
      pass = "geometry",
    }: { motion?: boolean; pass?: ScenePass } = {}
  ) => {
    const blockKey = `${name}-${pass}`;
    const blockContent =
      pass === "paint" ? renderGroupPaint(items) : items.map(renderLabItem);

    if (!motion) {
      return <g key={blockKey}>{blockContent}</g>;
    }

    const config = motionConfigFor(name);
    const peakRotate = peakRotateDeg(config);
    const pivotEntry = isArmGroup(name) ? armPivots[name] : undefined;
    const pivotPathId = pivotEntry?.pathId;
    const pivotPoint = resolveGroupMotionPivot(
      name,
      groups,
      armPivots,
      manifestById,
      splits
    );

    const staticItems = pivotPathId ? items.filter((item) => item.id === pivotPathId) : [];
    const rotatingItems = pivotPathId ? items.filter((item) => item.id !== pivotPathId) : items;
    const { x: cx, y: cy } = pivotPoint;

    const kind = motionKindForGroup(name, config);
    const staticContent =
      pass === "paint"
        ? renderGroupPaint(staticItems)
        : staticItems.map(renderLabItem);
    const rotatingContent =
      pass === "paint"
        ? renderGroupPaint(rotatingItems)
        : rotatingItems.map(renderLabItem);

    const hinge =
      motionDriver === "scroll" ? (
        <LabScrollHinge
          name={name}
          config={config}
          scrollProgress={scrollPreviewProgress}
          cx={cx}
          cy={cy}
        >
          {rotatingContent}
        </LabScrollHinge>
      ) : (
        <ArmHingeGroup
          cx={cx}
          cy={cy}
          labMotion={{
            kind,
            peakRotateDeg: peakRotate,
            duration: config.duration,
            continuous: config.continuous,
          }}
        >
          {rotatingContent}
        </ArmHingeGroup>
      );

    return (
      <g key={blockKey}>
        {staticContent}
        {rotatingItems.length > 0 && hinge}
      </g>
    );
  };

  const testMotionPivotPoint = useMemo(() => {
    if (!testMotion || !isArmGroup(activeGroup)) return null;
    return resolveArmPivotPoint(
      activeGroup,
      armPivots[activeGroup],
      armBaseIds[activeGroup],
      manifestById,
      splits
    );
  }, [activeGroup, armBaseIds, armPivots, manifestById, splits, testMotion]);

  const splitLineValue = selectedSplit?.value ?? splitValue;
  const activeSplitPreview = selectedSplit ?? currentSplitDraft;
  const splitLine = splitLineEndpoints(pathDocument.viewBox, activeSplitPreview);
  // Preview line only while drafting a new split — not after apply, not when selecting halves.
  const showSplitLine =
    selectedIds.size === 1 && selectedBaseId != null && !selectedSplit;

  /** Paint then geometry per group so group order controls full stacking (not just within one pass). */
  const renderScene = () => (
    <>
      {paintableGroupNames.map((name) => (
        <Fragment key={name}>
          {renderGroupBlock(name, groupedShapes.byGroup.get(name) ?? [], {
            motion: groupUsesMotion(name),
            pass: "paint",
          })}
          {renderGroupBlock(name, groupedShapes.byGroup.get(name) ?? [], {
            motion: groupUsesMotion(name),
            pass: "geometry",
          })}
        </Fragment>
      ))}
      <g id="unassigned-paint">{renderGroupPaint(groupedShapes.unassigned)}</g>
      <g id="unassigned-geometry">{groupedShapes.unassigned.map(renderLabItem)}</g>
    </>
  );

  const rootGroupOptions = groupNames.filter((name) => !isSubgroup(name));

  const renderParentGroupSelectOptions = (
    parent: ParentGroupName,
    withCounts: boolean
  ) => {
    const options = subgroupOptionsFor(groupNames, parent);
    if (!options.length) return null;

    return (
      <>
        <option value={parent}>
          {withCounts
            ? `${parent} (${subgroupPathCount(groups, parent)})`
            : parent}
        </option>
        {options.map((g) => (
          <option key={g} value={g}>
            {withCounts
              ? `${SUBGROUP_INDENT}${g} (${groups[g]?.length ?? 0})`
              : `${SUBGROUP_INDENT}${g}`}
          </option>
        ))}
      </>
    );
  };

  const renderGroupOrderInput = (name: string) => (
    <input
      type="number"
      min={0}
      step={1}
      value={groupOrder[name] ?? 0}
      onChange={(e) => setGroupOrderValue(name, Number(e.target.value))}
      aria-label={`Paint order for ${name}`}
      title="Paint order — higher draws on top"
      className="w-12 shrink-0 rounded bg-zinc-900 border border-zinc-700 px-1 py-0.5 font-mono text-[10px] text-right text-zinc-300"
    />
  );

  const renderParentGroupListSection = (parent: ParentGroupName) => {
    const options = subgroupOptionsFor(groupNames, parent);
    if (!options.length) return null;

    return (
      <div key={parent} className="space-y-2">
        <div className="text-zinc-400">
          {parent} ({subgroupPathCount(groups, parent)})
        </div>
        {options.map((g) => (
          <div
            key={g}
            className="flex items-start gap-2 pl-4 border-l border-zinc-800 ml-1"
          >
            {renderGroupOrderInput(g)}
            <div className="min-w-0 flex-1">
              <div className="text-zinc-500">{g}</div>
              <div className="font-mono text-xs text-zinc-500 break-all">
                {(groups[g] ?? []).join(", ") || "—"}
              </div>
            </div>
            {!lockedGroupNames.has(g) && (groups[g]?.length ?? 0) === 0 && (
              <button
                type="button"
                className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-red-900 hover:text-red-200"
                onClick={() => removeGroup(g)}
                title={`Remove empty group "${g}"`}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
    );
  };

  const marqueeRect = marquee
    ? {
      x: Math.min(marquee.x1, marquee.x2),
      y: Math.min(marquee.y1, marquee.y2),
      width: Math.abs(marquee.x2 - marquee.x1),
      height: Math.abs(marquee.y2 - marquee.y1),
    }
    : null;

  return (
    <>
      <div className="h-full min-h-0 overflow-hidden box-border bg-zinc-950 text-zinc-100 p-4 gap-4 flex flex-col lg:grid lg:grid-cols-[280px_1fr] lg:grid-rows-1">
        <aside className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain space-y-4 text-sm pr-1 lg:max-h-full scrollbar-thin scrollbar-track-zinc-950 scrollbar-thumb-zinc-600">
          <h1 className="text-lg font-semibold">Animation path lab</h1>
          <p className="text-zinc-400">
            Click to select one path, Shift+click to add/remove, drag to box-select. Scroll to zoom
            (Ctrl+scroll while previewing page scroll), Ctrl+drag or middle-click drag to pan.
          </p>

          <div className="rounded border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label={svgSourceOpen ? "Collapse SVG source" : "Expand SVG source"}
                aria-expanded={svgSourceOpen}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                onClick={() => setSvgSourceOpen((open) => !open)}
              >
                <ChevronDown
                  className={`size-3.5 transition-transform ${svgSourceOpen ? "" : "-rotate-90"}`}
                  strokeWidth={2.5}
                />
              </button>
              <div className="font-medium text-zinc-200">SVG source</div>
            </div>
            {svgSourceOpen && (
              <>
                <label className="block space-y-1">
                  <span className="text-zinc-400">Loaded SVG</span>
                  <select
                    className="w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1"
                    value={activeSvgId}
                    onChange={(e) => handleSavedSvgChange(e.target.value)}
                  >
                    {BUILTIN_SVGS.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                    {savedSvgs.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name} ({entry.document.shapes.length})
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex gap-2">
                  <input
                    ref={svgFileInputRef}
                    type="file"
                    accept=".svg,image/svg+xml"
                    className="hidden"
                    onChange={handleSvgFileChange}
                  />
                  <button
                    type="button"
                    className="flex flex-1 items-center justify-center gap-1.5 rounded bg-zinc-800 px-2 py-1.5 text-xs hover:bg-zinc-700"
                    onClick={() => svgFileInputRef.current?.click()}
                  >
                    <Upload className="size-3.5" strokeWidth={2.5} />
                    Add SVG
                  </button>
                  {!isBuiltinSvgId(activeSvgId) && (
                    <button
                      type="button"
                      aria-label={`Delete ${activeSvgName}`}
                      className="rounded bg-red-950 px-2 py-1.5 text-red-200 hover:bg-red-900"
                      onClick={() => deleteSavedSvg(activeSvgId)}
                    >
                      <Trash2 className="size-3.5" strokeWidth={2.5} />
                    </button>
                  )}
                </div>
                {isBuiltinSvgId(activeSvgId) && (
                  <button
                    type="button"
                    className="flex w-full items-center justify-center gap-1.5 rounded bg-zinc-800 px-2 py-1.5 text-xs hover:bg-zinc-700"
                    onClick={downloadBuiltinDump}
                  >
                    <Download className="size-3.5" strokeWidth={2.5} />
                    Download built-in dump
                  </button>
                )}
                <p className="text-[11px] text-zinc-500 leading-snug">
                  Upload an Illustrator SVG or pick a saved source. Built-in Hoxilo and Brain
                  keep their extracted groups and motion. Custom groups, splits, and pivots are stored per SVG.
                </p>
                <div className="font-mono text-[11px] text-zinc-500">
                  {activeSvgName} · {pathDocument.shapes.length} paths
                </div>
              </>
            )}
          </div>

          <label className="block space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-400">Active group</span>
                <button
                  type="button"
                  aria-label={showNewGroupForm ? "Hide new group" : "Add group"}
                  aria-pressed={showNewGroupForm}
                  className={`rounded p-1 ${showNewGroupForm
                      ? "bg-cyan-900 text-cyan-200 hover:bg-cyan-800"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                    }`}
                  onClick={() => setShowNewGroupForm((open) => !open)}
                >
                  <Plus className="size-3.5" strokeWidth={2.5} />
                </button>
              </div>
              <button
                type="button"
                className={`rounded px-2 py-0.5 text-[11px] ${showGroupPreview
                    ? "bg-cyan-900 text-cyan-200 hover:bg-cyan-800"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                onClick={() => setShowGroupPreview((open) => !open)}
              >
                {showGroupPreview ? "Hide preview" : "Preview layer"}
              </button>
            </div>
            <select
              className="w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1"
              value={activeGroup}
              onChange={(e) => handleActiveGroupChange(e.target.value)}
            >
              {PARENT_GROUP_NAMES.map((parent) =>
                renderParentGroupSelectOptions(parent, true)
              )}
              {rootGroupOptions.map((g) => (
                <option key={g} value={g}>
                  {g} ({groups[g]?.length ?? 0})
                </option>
              ))}
            </select>
            {showNewGroupForm && (
              <div className="space-y-2 pt-1">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addGroup();
                    }}
                    placeholder="new-group"
                    className="min-w-0 flex-1 rounded bg-zinc-900 border border-zinc-700 px-2 py-1 font-mono text-xs"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="rounded bg-zinc-800 px-2 py-1 hover:bg-zinc-700 disabled:opacity-40"
                    disabled={!normalizeGroupName(newGroupName)}
                    onClick={addGroup}
                  >
                    Add
                  </button>
                </div>
                <p className="text-[11px] text-zinc-500 leading-snug">
                  Names are lowercased; spaces become hyphens. Custom groups can be removed when empty.
                </p>
              </div>
            )}
          </label>

          {isArmGroup(activeGroup) && (
            <div className="rounded border border-cyan-900/60 bg-zinc-900 p-3 space-y-2">
              <div className="font-medium text-cyan-200">Arm pivot ({activeGroup})</div>
              <p className="text-[11px] text-zinc-500 leading-snug">
                Like a stick hinged at the pivot: the pivot path stays welded in place; every other
                path in this group swings from that point (not from the arm center). Click{" "}
                <span className="text-cyan-300">Set hinge point</span> then click inside the pivot path
                to move the crosshair.
              </p>
              <div className="font-mono text-xs">
                <span className="text-zinc-500">pivot</span>{" "}
                {activeArmPivotPathId ?? "auto (shoulder estimate)"}
              </div>
              <div className="font-mono text-[11px] text-zinc-500">
                hinge {armPivotOrigins[activeGroup]}
                {activeArmPivotEntry && hasCustomPivotPoint(activeArmPivotEntry) ? (
                  <span className="text-amber-300/90"> custom</span>
                ) : activeArmPivotPathId ? (
                  <span> auto</span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="flex-1 rounded bg-cyan-800 px-2 py-1 text-xs hover:bg-cyan-700 disabled:opacity-40"
                  disabled={selectedIds.size !== 1 || !primarySelected}
                  onClick={() => primarySelected && setArmPivotPath(activeGroup, primarySelected)}
                >
                  Use selected path
                </button>
                <button
                  type="button"
                  className="flex-1 rounded bg-amber-800 px-2 py-1 text-xs hover:bg-amber-700 disabled:opacity-40"
                  disabled={!activeArmPivotPathId}
                  onClick={beginPivotPlacement}
                >
                  {pivotPlacementMode ? "Click pivot path…" : "Set hinge point"}
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700 disabled:opacity-40"
                  disabled={!activeArmPivotEntry || !hasCustomPivotPoint(activeArmPivotEntry)}
                  onClick={() => clearArmPivotCustomPoint(activeGroup)}
                >
                  Reset hinge
                </button>
                <button
                  type="button"
                  className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700 disabled:opacity-40"
                  disabled={!activeArmPivotPathId}
                  onClick={() => clearArmPivotPath(activeGroup)}
                >
                  Clear pivot
                </button>
              </div>
              {pivotPlacementMode && (
                <p className="text-[11px] text-amber-300/90">
                  Click inside the gold-outlined pivot path to place the hinge crosshair.
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 rounded bg-cyan-700 px-2 py-1 hover:bg-cyan-600 disabled:opacity-40"
              disabled={selectedIds.size === 0}
              onClick={assignSelected}
            >
              Assign ({selectedIds.size})
            </button>
            <button
              type="button"
              className="flex-1 rounded bg-zinc-800 px-2 py-1 hover:bg-zinc-700 disabled:opacity-40"
              disabled={selectedIds.size === 0}
              onClick={removeSelected}
            >
              Unassign
            </button>
          </div>

          {selectedIds.size > 0 && (
            <div className="rounded border border-zinc-800 bg-zinc-900 p-3 space-y-1 font-mono text-xs">
              <div>
                <span className="text-zinc-500">selected</span> {selectedIds.size} path
                {selectedIds.size === 1 ? "" : "s"}
              </div>
              {selectedMeta && (
                <>
                  <div>
                    <span className="text-zinc-500">primary</span>{" "}
                    {primarySelected !== selectedMeta.id ? `${primarySelected} → ${selectedMeta.id}` : selectedMeta.id}
                  </div>
                  <div>
                    <span className="text-zinc-500">group</span>{" "}
                    {selectedGroups.length === 0 ? (
                      <span className="text-zinc-400">unassigned</span>
                    ) : selectedGroups.length === 1 && selectedGroups[0] === "unassigned" ? (
                      <span className="text-zinc-400">unassigned</span>
                    ) : (
                      selectedGroups.join(", ")
                    )}
                  </div>
                  <div>
                    <span className="text-zinc-500">class</span> {selectedMeta.className}
                  </div>
                  <div>
                    <span className="text-zinc-500">center</span> {selectedMeta.x}, {selectedMeta.y}
                  </div>
                  {selectedIds.size === 1 && selectedBaseId && (
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-zinc-500">split</span>
                        {selectedSplit ? (
                          selectedSplit.axis === "angle"
                            ? `∠${Math.round(selectedSplit.value)}° @ ${Math.round(selectedSplit.px ?? 0)},${Math.round(selectedSplit.py ?? 0)}`
                            : `${selectedSplit.axis}=${Math.round(selectedSplit.value)}`
                        ) : (
                          <span className="text-zinc-400">none</span>
                        )}
                        <button
                          type="button"
                          aria-label={showSplitPanel ? "Hide split path" : "Show split path"}
                          aria-pressed={showSplitPanel}
                          className={`rounded p-0.5 ${showSplitPanel
                              ? "bg-pink-900 text-pink-200 hover:bg-pink-800"
                              : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                            }`}
                          onClick={() => setShowSplitPanel((open) => !open)}
                        >
                          <Plus className="size-3" strokeWidth={2.5} />
                        </button>
                      </div>
                      {showSplitPanel && (
                        <div className="mt-2 pt-2 border-t border-zinc-800 space-y-3">
                          <div className="font-medium text-zinc-200">Split path</div>
                          <p className="text-[11px] text-zinc-500 leading-snug">
                            Clip the path into two halves ({makeSplitShapeId(selectedBaseId, "a")} /{" "}
                            {makeSplitShapeId(selectedBaseId, "b")}) so each can be assigned to a different group.
                          </p>
                          <label className="block space-y-1">
                            <span className="text-zinc-400 text-xs">Axis</span>
                            <select
                              className="w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-xs"
                              value={splitAxis}
                              onChange={(e) => {
                                const axis = e.target.value as SplitAxis;
                                setSplitAxis(axis);
                                if (axis === "angle" && splitAxis !== "angle" && splitValue > 359) {
                                  setSplitValue(45);
                                }
                                if (selectedSplit) {
                                  updateExistingSplit(
                                    selectedBaseId,
                                    buildSplitDraft(
                                      axis,
                                      axis === "angle" && splitValue > 359 ? 45 : splitValue,
                                      splitPx,
                                      splitPy
                                    )
                                  );
                                }
                              }}
                            >
                              <option value="y">Horizontal (upper / lower)</option>
                              <option value="x">Vertical (left / right)</option>
                              <option value="angle">Diagonal (angle)</option>
                            </select>
                          </label>
                          {splitAxis === "angle" ? (
                            <>
                              <label className="block space-y-1">
                                <span className="text-zinc-400 text-xs">
                                  Angle: {Math.round(splitLineValue)}° (0° east, 90° south)
                                </span>
                                <input
                                  type="range"
                                  min={0}
                                  max={359}
                                  step={1}
                                  value={((splitLineValue % 360) + 360) % 360}
                                  className="w-full"
                                  onChange={(e) => {
                                    const value = Number(e.target.value);
                                    const draft = buildSplitDraft("angle", value, splitPx, splitPy);
                                    if (selectedSplit) {
                                      updateExistingSplit(selectedBaseId, draft);
                                    } else {
                                      setSplitValue(value);
                                    }
                                  }}
                                />
                              </label>
                              <div className="font-mono text-[11px] text-zinc-500">
                                Line through ({Math.round(splitPx)}, {Math.round(splitPy)}) — use Place on canvas
                                to move the anchor point
                              </div>
                            </>
                          ) : (
                            <label className="block space-y-1">
                              <span className="text-zinc-400 text-xs">
                                Split at {splitAxis === "y" ? "Y" : "X"}: {Math.round(splitLineValue)}
                              </span>
                              <input
                                type="range"
                                min={0}
                                max={2048}
                                step={1}
                                value={splitLineValue}
                                className="w-full"
                                onChange={(e) => {
                                  const value = Number(e.target.value);
                                  const draft = buildSplitDraft(splitAxis, value, splitPx, splitPy);
                                  if (selectedSplit) {
                                    updateExistingSplit(selectedBaseId, draft);
                                  } else {
                                    setSplitValue(value);
                                  }
                                }}
                              />
                            </label>
                          )}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className={`flex-1 rounded px-2 py-1 text-xs ${splitPlacementMode
                                  ? "bg-pink-700 hover:bg-pink-600"
                                  : "bg-zinc-800 hover:bg-zinc-700"
                                }`}
                              onClick={() => setSplitPlacementMode((on) => !on)}
                            >
                              {splitPlacementMode ? "Click canvas…" : "Place on canvas"}
                            </button>
                            {selectedSplit ? (
                              <button
                                type="button"
                                className="flex-1 rounded bg-red-900 px-2 py-1 text-xs hover:bg-red-800"
                                onClick={() => removeSplit(selectedBaseId)}
                              >
                                Remove split
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="flex-1 rounded bg-pink-800 px-2 py-1 text-xs hover:bg-pink-700"
                                onClick={() => applySplit(selectedBaseId)}
                              >
                                Split path
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
              {selectedList.length > 1 && (
                <div className="text-zinc-500 break-all max-h-20 overflow-auto flex flex-wrap gap-x-1 gap-y-0.5">
                  {selectedList.map((id, index) => (
                    <span key={id} className="inline">
                      <button
                        type="button"
                        className="text-cyan-400 hover:text-cyan-200 hover:underline underline-offset-2"
                        title={`Select only ${id}`}
                        onClick={() => handleShapeClick(id, false)}
                      >
                        {id}
                      </button>
                      {index < selectedList.length - 1 ? "," : ""}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {selectedIds.size === 1 && primarySelected && (
            <div className="space-y-2">
              <button
                type="button"
                className="w-full rounded bg-violet-800 px-2 py-2 hover:bg-violet-700"
                onClick={findNestedPaths}
              >
                Find closed paths inside
              </button>
              <p className="text-[11px] text-zinc-500 leading-snug">
                Point-in-fill on path centers in authored SVG space (ignores motion preview). Skips open paths, lines, and thin slivers.
              </p>
              {nestedInside && (
                <div className="rounded border border-zinc-800 bg-zinc-900 p-3 space-y-2 font-mono text-xs">
                  <div className="text-zinc-400">
                    {nestedInside.length} path{nestedInside.length === 1 ? "" : "s"} inside {primarySelected}
                  </div>
                  {nestedInside.length > 0 ? (
                    <>
                      {(["below", "above"] as const).map((layer) => {
                        const entries = nestedInside.filter((entry) => entry.layer === layer);
                        if (!entries.length) return null;
                        return (
                          <div key={layer}>
                            <div className="text-zinc-500 mb-1">
                              {layer === "below" ? "painted under" : "painted on top"}
                            </div>
                            <div className="text-zinc-400 break-all max-h-24 overflow-auto">
                              {entries.map((entry) => `${entry.id} (${entry.className})`).join(", ")}
                            </div>
                          </div>
                        );
                      })}
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          className="flex-1 rounded bg-violet-900 px-2 py-1 hover:bg-violet-800"
                          onClick={() => selectNestedPaths(false)}
                        >
                          Select nested
                        </button>
                        <button
                          type="button"
                          className="flex-1 rounded bg-violet-900 px-2 py-1 hover:bg-violet-800"
                          onClick={() => selectNestedPaths(true)}
                        >
                          + container
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="text-zinc-500">No closed filled paths found inside.</div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={testMotion}
                onChange={(e) => setTestMotion(e.target.checked)}
              />
              Preview motion
              {motionDriver === "time" && isParentGroup(activeGroup) && (
                <span className="text-[11px] text-zinc-500">(each child uses its own settings)</span>
              )}
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                className={`flex-1 rounded px-2 py-1 text-xs ${
                  motionDriver === "time"
                    ? "bg-cyan-800 text-cyan-50 hover:bg-cyan-700"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                }`}
                onClick={() => {
                  setMotionDriver("time");
                  setTestMotion(true);
                }}
              >
                Time loop
              </button>
              <button
                type="button"
                className={`flex-1 rounded px-2 py-1 text-xs ${
                  motionDriver === "scroll"
                    ? "bg-cyan-800 text-cyan-50 hover:bg-cyan-700"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                }`}
                onClick={() => {
                  setMotionDriver("scroll");
                  setTestMotion(true);
                }}
              >
                Scroll
              </button>
            </div>
            <p className="text-[11px] text-zinc-500 leading-snug">
              Saved with this SVG and used on the About-page character.
            </p>
            {motionDriver === "scroll" && testMotion && (
              <label className="block space-y-1">
                <span className="text-zinc-400 text-xs">
                  Scroll progress: {Math.round(scrollPreview * 100)}%
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(scrollPreview * 100)}
                  className="w-full"
                  onChange={(e) => setScrollProgress(Number(e.target.value) / 100)}
                />
                <p className="text-[11px] text-zinc-500 leading-snug">
                  All groups follow About-page scroll. Wheel on the canvas scrubs progress;
                  Ctrl+wheel still zooms.
                </p>
              </label>
            )}
          </div>

          <div
            className={`rounded border border-zinc-800 bg-zinc-900/50 p-3 space-y-2 ${
              isParentGroup(activeGroup) ? "opacity-60" : ""
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium text-zinc-200">Motion — {activeGroup}</div>
              {!isParentGroup(activeGroup) && (
                <button
                  type="button"
                  className="shrink-0 rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                  onClick={resetActiveGroupMotion}
                >
                  Reset defaults
                </button>
              )}
            </div>
            {isParentGroup(activeGroup) ? (
              <p className="text-[11px] text-zinc-500 leading-snug">
                <span className="text-zinc-400">{activeGroup}</span> is a virtual grouping — it has
                no paths and no motion of its own. Select a child group (
                {GROUP_HIERARCHY[activeGroup].join(", ")}) to edit peak rotation, direction, and
                timing for test preview and About-page scroll.
              </p>
            ) : (
              <>
                <p className="text-[11px] text-zinc-500 leading-snug">
                  Peak rotation and timing for test preview and About-page scroll motion.
                  Brain cogs use linear spin around each path center; Hoxilo body groups use sway by default.
                  {isArmGroup(activeGroup) && " Arms also stretch along the bone at peak swing."}
                </p>
                <label className="block space-y-1">
                  <span className="text-zinc-400 text-xs">Motion mode</span>
                  <select
                    className="w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1"
                    value={activeMotionConfig.mode ?? "sway"}
                    onChange={(e) =>
                      updateActiveGroupMotion({
                        mode: e.target.value as GroupMotionMode,
                      })
                    }
                  >
                    <option value="sway">Sway (ease in-out)</option>
                    <option value="spin">Spin (linear, group pivot)</option>
                    <option value="spin-center">Spin center (linear, path center)</option>
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!activeMotionConfig.continuous}
                    onChange={(e) =>
                      updateActiveGroupMotion({ continuous: e.target.checked })
                    }
                  />
                  Continuous rotation
                </label>
                {activeMotionConfig.continuous && (
                  <p className="text-[11px] text-zinc-500 leading-snug">
                    Keeps turning in the same direction. Peak ° is how far it rotates each cycle;
                    duration is the time for that turn.
                  </p>
                )}
                <label className="block space-y-1">
                  <span className="text-zinc-400 text-xs">
                    {activeMotionConfig.continuous
                      ? `Degrees per cycle: ${activeMotionConfig.peakDeg.toFixed(1)}°`
                      : `Peak rotation: ${activeMotionConfig.peakDeg.toFixed(1)}°`}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={isLinearSpinMode(activeMotionConfig.mode) ? 360 : Math.max(12, activeMotionConfig.peakDeg)}
                    step={isLinearSpinMode(activeMotionConfig.mode) ? 1 : 0.1}
                    value={activeMotionConfig.peakDeg}
                    className="w-full"
                    onChange={(e) =>
                      updateActiveGroupMotion({ peakDeg: Number(e.target.value) })
                    }
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-zinc-400 text-xs">Direction</span>
                  <select
                    className="w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1"
                    value={activeMotionConfig.direction}
                    onChange={(e) =>
                      updateActiveGroupMotion({
                        direction: Number(e.target.value) as GroupMotionDirection,
                      })
                    }
                  >
                    <option value={1}>Clockwise (+)</option>
                    <option value={-1}>Counter-clockwise (−)</option>
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-zinc-400 text-xs">
                    {activeMotionConfig.continuous
                      ? `Time per cycle: ${activeMotionConfig.duration.toFixed(1)}s`
                      : `Cycle duration: ${activeMotionConfig.duration.toFixed(1)}s`}
                  </span>
                  <input
                    type="range"
                    min={0.8}
                    max={isLinearSpinMode(activeMotionConfig.mode) ? 12 : 6}
                    step={0.1}
                    value={activeMotionConfig.duration}
                    className="w-full"
                    onChange={(e) =>
                      updateActiveGroupMotion({ duration: Number(e.target.value) })
                    }
                  />
                </label>
                <div className="font-mono text-[11px] text-zinc-500">
                  Peak at {peakRotateDeg(activeMotionConfig).toFixed(1)}° ·{" "}
                  {motionKindForGroup(activeGroup, activeMotionConfig) === "arm"
                    ? "arm hinge"
                    : motionKindForGroup(activeGroup, activeMotionConfig) === "spin-center"
                      ? "spin around path center"
                      : motionKindForGroup(activeGroup, activeMotionConfig) === "spin"
                        ? "cog spin"
                        : "group rotate"}
                </div>
              </>
            )}
          </div>

          <div className="rounded border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label={groupToolsOpen ? "Collapse group tools" : "Expand group tools"}
                aria-expanded={groupToolsOpen}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                onClick={() => setGroupToolsOpen((open) => !open)}
              >
                <ChevronDown
                  className={`size-3.5 transition-transform ${groupToolsOpen ? "" : "-rotate-90"}`}
                  strokeWidth={2.5}
                />
              </button>
              <div className="font-medium text-zinc-200">Group tools</div>
            </div>
            {groupToolsOpen && (
              <>
                <label className="block space-y-1">
                  <span className="text-zinc-400">Solo group (dim others)</span>
                  <select
                    className="w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1"
                    value={soloGroup ?? ""}
                    onChange={(e) => setSoloGroup(e.target.value || null)}
                  >
                    <option value="">All visible</option>
                    {PARENT_GROUP_NAMES.map((parent) =>
                      renderParentGroupSelectOptions(parent, false)
                    )}
                    {rootGroupOptions.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </label>

                <button type="button" className="w-full rounded bg-emerald-800 px-2 py-2 hover:bg-emerald-700" onClick={exportJson}>
                  Copy groups JSON
                </button>

                <button type="button" className="w-full rounded bg-zinc-800 px-2 py-2 hover:bg-zinc-700" onClick={resetGroups}>
                  Reset saved groups
                </button>

                <button type="button" className="w-full rounded bg-zinc-800 px-2 py-2 hover:bg-zinc-700" onClick={suggestByY}>
                  Suggest groups by Y (starting point)
                </button>

                <div className="space-y-2 max-h-64 overflow-auto">
                  <p className="text-[11px] text-zinc-500 leading-snug">
                    Order: higher number draws on top (minimum 0).
                  </p>
                  {PARENT_GROUP_NAMES.map((parent) => renderParentGroupListSection(parent))}
                  {rootGroupOptions.map((g) => (
                    <div key={g} className="flex items-start gap-2">
                      {renderGroupOrderInput(g)}
                      <div className="min-w-0 flex-1">
                        <div className="text-zinc-400">{g}</div>
                        <div className="font-mono text-xs text-zinc-500 break-all">
                          {(groups[g] ?? []).join(", ") || "—"}
                        </div>
                      </div>
                      {!lockedGroupNames.has(g) && (groups[g]?.length ?? 0) === 0 && (
                        <button
                          type="button"
                          className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-red-900 hover:text-red-200"
                          onClick={() => removeGroup(g)}
                          title={`Remove empty group "${g}"`}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </aside>

        <div
          ref={canvasRef}
          className={`relative min-h-0 flex-1 rounded border border-zinc-800 bg-white/5 p-2 overflow-hidden ${canvasCursor}`}
        >
          <div className="pointer-events-none absolute top-3 right-3 z-30 flex items-center gap-2">
            <span className="pointer-events-none rounded bg-zinc-900/90 border border-zinc-700 px-2 py-1 text-[11px] font-mono text-zinc-400">
              {zoomPercent}%
            </span>
            <button
              type="button"
              className="pointer-events-auto rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
              disabled={isDefaultView}
              onClick={resetViewBox}
            >
              Reset view
            </button>
          </div>
          {previewShape && previewMeta && !marquee && (
            <PathPreviewPanel
              shape={previewShape}
              meta={previewMeta}
              styleCss={pathDocument.styleCss}
              previewViewBox={previewViewBox}
              fillOverride={previewFillOverride}
              onShapeChange={handlePreviewShapeChange}
            />
          )}
          {showGroupPreview && !marquee && (
            <div className="absolute bottom-3 left-3 z-20 w-56 h-56 rounded-lg border border-zinc-600 bg-zinc-900/95 shadow-xl overflow-hidden pointer-events-none">
              <svg
                viewBox={groupPreviewViewBox}
                width="100%"
                height="100%"
                preserveAspectRatio="xMidYMid meet"
                aria-hidden
              >
                <rect
                  x={groupPreviewBounds.x}
                  y={groupPreviewBounds.y}
                  width={groupPreviewBounds.w}
                  height={groupPreviewBounds.h}
                  fill="#18181b"
                />
                <style dangerouslySetInnerHTML={{ __html: pathDocument.styleCss }} />
                <defs>
                  {activeGroupShapes.flatMap((item) => {
                    if (!item.part || !item.split) return [];
                    return (
                      <clipPath
                        key={`preview-${splitClipPathId(item.shape.id, item.part)}`}
                        id={`preview-${splitClipPathId(item.shape.id, item.part)}`}
                        clipPathUnits="userSpaceOnUse"
                      >
                        <polygon
                          points={clipPolygonPointsForPart(
                            pathDocument.viewBox,
                            item.split,
                            item.part
                          )}
                        />
                      </clipPath>
                    );
                  })}
                </defs>
                <DedupedPaintLayersGraphic
                  items={activeGroupShapes.map((item) => ({
                    baseId: getBaseShapeId(item.id),
                    paintLayers: item.shape.paintLayers,
                    className: item.shape.className,
                    fillOverride: shapeFillOverrides[item.shape.id],
                  }))}
                />
                {activeGroupShapes.map((item) => (
                  <g key={item.id}>
                    {renderShapeGeometry(item.shape, {
                      className: item.shape.className,
                      fill: shapeFillOverrides[item.shape.id],
                      opacity: 1,
                      stroke: "none",
                      clipPath:
                        item.part && item.split
                          ? `url(#preview-${splitClipPathId(item.shape.id, item.part)})`
                          : undefined,
                    })}
                  </g>
                ))}
              </svg>
              <div className="absolute inset-x-0 bottom-0 bg-black/75 px-2 py-1 text-[10px] font-mono text-zinc-300 truncate">
                {activeGroup} · {activeGroupShapes.length} path
                {activeGroupShapes.length === 1 ? "" : "s"}
              </div>
            </div>
          )}
          <div
            ref={interactionRef}
            className="h-full w-full select-none touch-none"
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onPointerCancel={handleCanvasPointerUp}
            onContextMenu={(e) => e.preventDefault()}
          >
            <svg
              ref={svgRef}
              viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
              width="100%"
              height="100%"
              preserveAspectRatio="xMidYMid meet"
            >
              <style dangerouslySetInnerHTML={{ __html: pathDocument.styleCss }} />
              <defs>
                <filter id="hoshino-selected-brighten" colorInterpolationFilters="sRGB">
                  <feComponentTransfer>
                    <feFuncR type="linear" slope="1.28" intercept="0.08" />
                    <feFuncG type="linear" slope="1.22" intercept="0.05" />
                    <feFuncB type="linear" slope="1.22" intercept="0.05" />
                  </feComponentTransfer>
                </filter>
                {Object.entries(splits).flatMap(([baseId, split]) =>
                  (["a", "b"] as const).map((part) => (
                    <clipPath key={splitClipPathId(baseId, part)} id={splitClipPathId(baseId, part)} clipPathUnits="userSpaceOnUse">
                      <polygon
                        points={clipPolygonPointsForPart(pathDocument.viewBox, split, part)}
                      />
                    </clipPath>
                  ))
                )}
              </defs>
              {renderScene()}
              {Object.entries(armPivots).map(([group, entry]) => {
                if (!entry?.pathId || !isArmGroup(group)) return null;
                const pt = resolveArmPivotPoint(
                  group,
                  entry,
                  armBaseIds[group],
                  manifestById,
                  splits
                );
                const isActiveTestPivot =
                  testMotion && isArmGroup(activeGroup) && activeGroup === group;
                if (isActiveTestPivot) return null;
                return renderPivotMarker(`pivot-${group}`, pt, { assigned: true });
              })}
              {isArmGroup(activeGroup) &&
                testMotionPivotPoint &&
                renderPivotMarker(`pivot-test-${activeGroup}`, testMotionPivotPoint, {
                  assigned: !!activeArmPivotPathId,
                  active: true,
                })}
              {showSplitLine && (
                <>
                  <line
                    x1={splitLine.x1}
                    y1={splitLine.y1}
                    x2={splitLine.x2}
                    y2={splitLine.y2}
                    stroke="#ec4899"
                    strokeWidth={3}
                    strokeDasharray="10 6"
                    pointerEvents="none"
                  />
                  {activeSplitPreview.axis === "angle" && (
                    <circle
                      cx={splitPx}
                      cy={splitPy}
                      r={8}
                      fill="#ec4899"
                      opacity={0.85}
                      pointerEvents="none"
                    />
                  )}
                </>
              )}
              {marqueeRect && (
                <rect
                  x={marqueeRect.x}
                  y={marqueeRect.y}
                  width={marqueeRect.width}
                  height={marqueeRect.height}
                  fill="rgba(34, 211, 238, 0.12)"
                  stroke="#22d3ee"
                  strokeWidth={3}
                  strokeDasharray="8 4"
                  pointerEvents="none"
                />
              )}
            </svg>
          </div>
        </div>
      </div>

      <Dialog
        open={reassignConfirm != null}
        onClose={() => setReassignConfirm(null)}
        className="relative z-50"
      >
        <DialogBackdrop
          transition
          className="fixed inset-0 bg-black/60 transition-opacity data-closed:opacity-0"
        />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel
            transition
            className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-xl transition-all data-closed:scale-95 data-closed:opacity-0"
          >
            <DialogTitle className="text-base font-semibold text-zinc-100">
              Reassign paths?
            </DialogTitle>
            <p className="mt-2 text-sm text-zinc-400">
              {reassignConfirm?.reassignments.length === 1
                ? "This path is already assigned to another group:"
                : "Some selected paths are already assigned to other groups:"}
            </p>
            <ul className="mt-3 max-h-40 space-y-1 overflow-auto rounded border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-300">
              {reassignConfirm?.reassignments.map(({ id, fromGroup }) => (
                <li key={id}>
                  {id}{" "}
                  <span className="text-zinc-500">
                    ({fromGroup} → {activeGroup})
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-zinc-400">
              Move {reassignConfirm?.reassignments.length === 1 ? "it" : "them"} to{" "}
              <span className="font-medium text-zinc-200">{activeGroup}</span>?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700"
                onClick={() => setReassignConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded bg-cyan-700 px-3 py-1.5 text-sm text-white hover:bg-cyan-600"
                onClick={confirmReassign}
              >
                Reassign
              </button>
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
};

export default AnimationPathLab;
