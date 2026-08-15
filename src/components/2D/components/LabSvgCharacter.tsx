"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { type MotionValue, useSpring, useTransform } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FlaskConical, RefreshCw } from "lucide-react";
import defaultPathsData from "@/components/2D/assets/hoshino-new/paths.json";
import { DedupedPaintLayersGraphic } from "@/components/2D/components/PathPreviewPanel";
import { FilledPathGeometry } from "@/components/2D/components/FilledPathGeometry";
import { ArmHingeGroup } from "@/components/2D/components/ArmHingeGroup";
import {
  armBoneScaleFromRotation,
  armWidthScaleFromBoneScale,
} from "@/components/2D/utils/charArmMotion";
import {
  BRAIN_SVG_ID,
  BUILTIN_SVGS,
  DEFAULT_SVG_ID,
  applyDefaultShapeOverrides,
  getBuiltinSvg,
  manifestFromShapes,
  readLabSession,
  readSavedSvgs,
  writeActiveSvgId,
  parseMotionDriver,
  type MotionDriver,
  type PathDocument,
  type PathShape,
  type SavedSvg,
} from "@/components/2D/utils/charLabSvg";
import {
  clipPolygonPointsForPart,
  expandShapesForLab,
  getBaseShapeId,
  parseSplitShapeId,
  splitClipPathId,
  type PathSplit,
  type SplitPart,
} from "@/components/2D/utils/charPathSplits";
import {
  getArmPivotPathId,
  parsePivotOrigin,
  type ArmPivotConfig,
} from "@/components/2D/utils/charPathPivots";
import {
  DEFAULT_GROUP_PAINT_ORDER,
  mergeStoredGroupOrders,
  sortGroupNamesByOrder,
} from "@/components/2D/utils/charPathGroups";
import {
  getShapeSilhouetteD,
  migrateHandDrawToUnderlay,
} from "@/components/2D/utils/charShapePaint";
import {
  isLinearSpinMode,
  motionKindForGroup,
  motionPivotOrigin,
  peakRotateDeg,
  resolveGroupMotionConfig,
  scrollSwayAtProgress,
  scrollSwayAtProgressLinear,
  type GroupMotionConfig,
} from "@/components/2D/utils/charGroupMotion";

type GroupItem = {
  key: string;
  shape: PathShape;
  baseId: string;
  clipPart: SplitPart | null;
};

export type LabSvgCharacterProps = {
  scrollYProgress: MotionValue<number>;
  className?: string;
  /** Show a button below the SVG to cycle saved sources. Default true. */
  showSvgSwitcher?: boolean;
  /** Override the initially loaded SVG; otherwise uses the lab's last active SVG. */
  initialSvgId?: string;
};

const KNOWN_GROUP_NAMES = new Set<string>(DEFAULT_GROUP_PAINT_ORDER);

/** Groups driven by scroll + lab motion settings. */
type ScrollMotionGroup =
  | "hair-back"
  | "hair-front"
  | "head"
  | "hat"
  | "detail"
  | "torso"
  | "arm-left"
  | "arm-right"
  | "skirt"
  | "leg-left"
  | "leg-right";

const LINEAR_SCROLL_GROUPS = new Set<string>(["leg-left", "leg-right"]);

/** Slightly overdamped so it tracks scroll without bounce or a trailing beat. */
const SPRING = { stiffness: 500, damping: 28, mass: 0.25, restDelta: 0.0008 };

const DEFAULT_BUILTIN = getBuiltinSvg(BRAIN_SVG_ID) ?? BUILTIN_SVGS[0];

function withBrainFirst<T extends { id: string }>(entries: T[]): T[] {
  const brain = entries.find((entry) => entry.id === BRAIN_SVG_ID);
  if (!brain) return entries;
  return [brain, ...entries.filter((entry) => entry.id !== BRAIN_SVG_ID)];
}

function renderShapeGeometry(
  shape: PathShape,
  clipPart: SplitPart | null,
  splits: Record<string, PathSplit>
) {
  const split = splits[shape.id];
  const clipId =
    clipPart && split ? splitClipPathId(shape.id, clipPart) : undefined;
  const clipProps = clipId ? { clipPath: `url(#${clipId})` } : {};
  const { attrs } = shape;
  const silhouetteD = getShapeSilhouetteD(shape);

  if (shape.tag === "path" && silhouetteD) {
    return (
      <FilledPathGeometry
        d={silhouetteD}
        transform={attrs.transform}
        className={shape.className}
        fillRule={attrs.fillRule as "evenodd" | "nonzero" | undefined}
        {...clipProps}
      />
    );
  }
  if (shape.tag === "polygon" && attrs.points) {
    return (
      <polygon
        points={attrs.points}
        transform={attrs.transform}
        className={shape.className}
        {...clipProps}
      />
    );
  }
  if (shape.tag === "rect" && attrs.x != null) {
    return (
      <rect
        x={attrs.x}
        y={attrs.y}
        width={attrs.width}
        height={attrs.height}
        transform={attrs.transform}
        className={shape.className}
        {...clipProps}
      />
    );
  }
  return null;
}

type LayerPass = "paint" | "geometry";

function ShapeGeometryList({
  items,
  splits,
}: {
  items: GroupItem[];
  splits: Record<string, PathSplit>;
}) {
  return (
    <>
      {items.map((item) => (
        <g key={item.key}>{renderShapeGeometry(item.shape, item.clipPart, splits)}</g>
      ))}
    </>
  );
}

function PaintLayersList({ items }: { items: GroupItem[] }) {
  return (
    <DedupedPaintLayersGraphic
      items={items.map((item) => ({
        baseId: item.baseId,
        paintLayers: item.shape.paintLayers,
        className: item.shape.className,
      }))}
    />
  );
}

function ShapeList({
  items,
  splits,
  pass,
}: {
  items: GroupItem[];
  splits: Record<string, PathSplit>;
  pass: LayerPass;
}) {
  if (pass === "paint") return <PaintLayersList items={items} />;
  return <ShapeGeometryList items={items} splits={splits} />;
}

function GroupPasses({
  items,
  splits,
}: {
  items: GroupItem[];
  splits: Record<string, PathSplit>;
}) {
  return (
    <>
      <ShapeList items={items} splits={splits} pass="paint" />
      <ShapeList items={items} splits={splits} pass="geometry" />
    </>
  );
}

/** Scroll-driven hinge — CSS transform around the group pivot (GPU composited). */
function GroupMotionLayer({
  id,
  items,
  splits,
  rotate,
  pivotOrigin,
  originMode = "pivot",
}: {
  id: string;
  items: GroupItem[];
  splits: Record<string, PathSplit>;
  rotate: MotionValue<number>;
  pivotOrigin: string;
  originMode?: "pivot" | "fill-center";
}) {
  const { x: cx, y: cy } = parsePivotOrigin(pivotOrigin);

  return (
    <g id={id}>
      <ArmHingeGroup cx={cx} cy={cy} originMode={originMode} liveMotion={{ rotate }}>
        <GroupPasses items={items} splits={splits} />
      </ArmHingeGroup>
    </g>
  );
}

function ArmMotionLayer({
  id,
  items,
  splits,
  rotate,
  pivotOrigin,
  pivotPathId,
}: {
  id: string;
  items: GroupItem[];
  splits: Record<string, PathSplit>;
  rotate: MotionValue<number>;
  pivotOrigin: string;
  pivotPathId?: string;
}) {
  const { x: cx, y: cy } = parsePivotOrigin(pivotOrigin);
  const scaleX = useTransform(rotate, (deg) => armBoneScaleFromRotation(deg));
  const scaleY = useTransform(scaleX, (sx) => armWidthScaleFromBoneScale(sx));

  const staticItems = pivotPathId
    ? items.filter((item) => item.key === pivotPathId)
    : [];
  const rotatingItems = pivotPathId
    ? items.filter((item) => item.key !== pivotPathId)
    : items;

  return (
    <g id={id}>
      <GroupPasses items={staticItems} splits={splits} />
      {rotatingItems.length > 0 && (
        <ArmHingeGroup cx={cx} cy={cy} liveMotion={{ rotate, scaleX, scaleY }}>
          <GroupPasses items={rotatingItems} splits={splits} />
        </ArmHingeGroup>
      )}
    </g>
  );
}

function ExtraGroupScrollLayer({
  name,
  items,
  splits,
  scrollProgress,
  config,
  pivotOrigin,
}: {
  name: string;
  items: GroupItem[];
  splits: Record<string, PathSplit>;
  scrollProgress: MotionValue<number>;
  config: GroupMotionConfig;
  pivotOrigin: string;
}) {
  const rotate = useTransform(scrollProgress, (t) =>
    isLinearSpinMode(config.mode)
      ? scrollSwayAtProgressLinear(t, config)
      : scrollSwayAtProgress(t, config)
  );

  return (
    <GroupMotionLayer
      id={name}
      items={items}
      splits={splits}
      rotate={rotate}
      pivotOrigin={pivotOrigin}
      originMode={config.mode === "spin-center" ? "fill-center" : "pivot"}
    />
  );
}

function GroupTimeLayer({
  id,
  items,
  splits,
  config,
  pivotOrigin,
}: {
  id: string;
  items: GroupItem[];
  splits: Record<string, PathSplit>;
  config: GroupMotionConfig;
  pivotOrigin: string;
}) {
  const { x: cx, y: cy } = parsePivotOrigin(pivotOrigin);
  const kind = motionKindForGroup(id, config);

  return (
    <g id={id}>
      <ArmHingeGroup
        cx={cx}
        cy={cy}
        originMode={config.mode === "spin-center" ? "fill-center" : "pivot"}
        labMotion={{
          kind,
          peakRotateDeg: peakRotateDeg(config),
          duration: config.duration,
          continuous: config.continuous,
        }}
      >
        <GroupPasses items={items} splits={splits} />
      </ArmHingeGroup>
    </g>
  );
}

function ArmTimeLayer({
  id,
  items,
  splits,
  config,
  pivotOrigin,
  pivotPathId,
}: {
  id: string;
  items: GroupItem[];
  splits: Record<string, PathSplit>;
  config: GroupMotionConfig;
  pivotOrigin: string;
  pivotPathId?: string;
}) {
  const { x: cx, y: cy } = parsePivotOrigin(pivotOrigin);
  const staticItems = pivotPathId
    ? items.filter((item) => item.key === pivotPathId)
    : [];
  const rotatingItems = pivotPathId
    ? items.filter((item) => item.key !== pivotPathId)
    : items;

  return (
    <g id={id}>
      <GroupPasses items={staticItems} splits={splits} />
      {rotatingItems.length > 0 && (
        <ArmHingeGroup
          cx={cx}
          cy={cy}
          labMotion={{
            kind: "arm",
            peakRotateDeg: peakRotateDeg(config),
            duration: config.duration,
            continuous: config.continuous,
          }}
        >
          <GroupPasses items={rotatingItems} splits={splits} />
        </ArmHingeGroup>
      )}
    </g>
  );
}

function renderCharacterScene(ctx: {
  sortedGroupNames: string[];
  getItems: (name: string) => GroupItem[];
  splits: Record<string, PathSplit>;
  motionPivotOrigins: Record<string, string>;
  armPivots: ArmPivotConfig;
  groupSways: Partial<Record<string, MotionValue<number>>>;
  groupMotion: Record<string, GroupMotionConfig>;
  scrollProgress: MotionValue<number>;
  motionDriver: MotionDriver;
}) {
  const {
    sortedGroupNames,
    getItems,
    splits,
    motionPivotOrigins,
    armPivots,
    groupSways,
    groupMotion,
    scrollProgress,
    motionDriver,
  } = ctx;

  const renderNamedGroup = (name: string) => {
    const items = getItems(name);
    if (items.length === 0) return null;

    const sway = groupSways[name];
    const pivotOrigin = motionPivotOrigins[name];
    const config = resolveGroupMotionConfig(name, groupMotion[name]);
    const hasStored = groupMotion[name] != null;
    const usesMotion =
      !!sway || isLinearSpinMode(config.mode) || hasStored;

    if (motionDriver === "time") {
      if (!pivotOrigin || !usesMotion) {
        return (
          <g key={name} id={name}>
            <GroupPasses items={items} splits={splits} />
          </g>
        );
      }
      if (name === "arm-left" || name === "arm-right") {
        return (
          <ArmTimeLayer
            key={name}
            id={name}
            items={items}
            splits={splits}
            config={config}
            pivotOrigin={pivotOrigin}
            pivotPathId={getArmPivotPathId(armPivots, name)}
          />
        );
      }
      return (
        <GroupTimeLayer
          key={name}
          id={name}
          items={items}
          splits={splits}
          config={config}
          pivotOrigin={pivotOrigin}
        />
      );
    }

    if (name === "arm-left" || name === "arm-right") {
      if (!sway || !pivotOrigin) {
        return (
          <g key={name} id={name}>
            <GroupPasses items={items} splits={splits} />
          </g>
        );
      }
      return (
        <ArmMotionLayer
          key={name}
          id={name}
          items={items}
          splits={splits}
          rotate={sway}
          pivotOrigin={pivotOrigin}
          pivotPathId={getArmPivotPathId(armPivots, name)}
        />
      );
    }

    if (sway && pivotOrigin) {
      return (
        <GroupMotionLayer
          key={name}
          id={name}
          items={items}
          splits={splits}
          rotate={sway}
          pivotOrigin={pivotOrigin}
        />
      );
    }

    if (pivotOrigin && (isLinearSpinMode(config.mode) || hasStored)) {
      return (
        <ExtraGroupScrollLayer
          key={name}
          name={name}
          items={items}
          splits={splits}
          scrollProgress={scrollProgress}
          config={config}
          pivotOrigin={pivotOrigin}
        />
      );
    }

    return (
      <g key={name} id={name}>
        <GroupPasses items={items} splits={splits} />
      </g>
    );
  };

  return <>{sortedGroupNames.map((name) => renderNamedGroup(name))}</>;
}

function LabSvgCharacter({
  scrollYProgress,
  className,
  showSvgSwitcher = true,
  initialSvgId,
}: LabSvgCharacterProps) {
  const pathname = usePathname();
  const locale = pathname.split("/").filter(Boolean)[0] || "en";
  const labHref = `/${locale}/animation-lab`;
  const [savedSvgs, setSavedSvgs] = useState<SavedSvg[]>([]);
  const [activeSvgId, setActiveSvgId] = useState(DEFAULT_BUILTIN.id);
  const [activeSvgName, setActiveSvgName] = useState(DEFAULT_BUILTIN.name);
  const [pathDocument, setPathDocument] = useState<PathDocument>(DEFAULT_BUILTIN.document);
  const [groups, setGroups] = useState<Record<string, string[]>>({});
  const [groupOrder, setGroupOrder] = useState<Record<string, number>>({});
  const [splits, setSplits] = useState<Record<string, PathSplit>>({});
  const [armPivots, setArmPivots] = useState<ArmPivotConfig>({});
  const [groupMotion, setGroupMotion] = useState<Record<string, GroupMotionConfig>>({});
  const [hydrated, setHydrated] = useState(false);
  const [motionDriver, setMotionDriver] = useState<MotionDriver>("scroll");

  const applySvg = useCallback((svgId: string, document: PathDocument, name: string) => {
    const session = readLabSession(svgId);
    const baselineById =
      svgId === DEFAULT_SVG_ID
        ? new Map(
            (defaultPathsData as PathDocument).shapes.map((shape) => [
              shape.id,
              shape.attrs.d ?? "",
            ])
          )
        : undefined;
    setActiveSvgId(svgId);
    setActiveSvgName(name);
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
    writeActiveSvgId(svgId);
  }, []);

  useEffect(() => {
    const library = readSavedSvgs();
    setSavedSvgs(library);

    const preferredId = initialSvgId ?? BRAIN_SVG_ID;
    const builtin = getBuiltinSvg(preferredId);
    if (builtin) {
      applySvg(builtin.id, builtin.document, builtin.name);
    } else {
      const saved = library.find((entry) => entry.id === preferredId);
      if (saved) {
        applySvg(saved.id, saved.document, saved.name);
      } else {
        applySvg(DEFAULT_BUILTIN.id, DEFAULT_BUILTIN.document, DEFAULT_BUILTIN.name);
      }
    }
    setHydrated(true);
  }, [applySvg, initialSvgId]);

  const svgOptions = useMemo(
    () =>
      withBrainFirst([
        ...BUILTIN_SVGS.map((entry) => ({
          id: entry.id,
          name: entry.name,
          document: entry.document,
        })),
        ...savedSvgs.map((entry) => ({
          id: entry.id,
          name: entry.name,
          document: entry.document,
        })),
      ]),
    [savedSvgs]
  );

  const cycleSvg = useCallback(() => {
    const library = readSavedSvgs();
    setSavedSvgs(library);

    const options = withBrainFirst([
      ...BUILTIN_SVGS.map((entry) => ({
        id: entry.id,
        name: entry.name,
        document: entry.document,
      })),
      ...library.map((entry) => ({
        id: entry.id,
        name: entry.name,
        document: entry.document,
      })),
    ]);
    const index = options.findIndex((entry) => entry.id === activeSvgId);
    const next = options[(index + 1) % options.length];
    applySvg(next.id, next.document, next.name);
  }, [activeSvgId, applySvg]);

  const smoothScroll = useSpring(scrollYProgress, SPRING);

  const motionConfigFor = useCallback(
    (name: string) => resolveGroupMotionConfig(name, groupMotion[name]),
    [groupMotion]
  );

  const scrollSwayFor = useCallback(
    (name: string, progress: number) => {
      const config = motionConfigFor(name);
      return LINEAR_SCROLL_GROUPS.has(name)
        ? scrollSwayAtProgressLinear(progress, config)
        : scrollSwayAtProgress(progress, config);
    },
    [motionConfigFor]
  );

  const hairBackSway = useTransform(smoothScroll, (t) => scrollSwayFor("hair-back", t));
  const hairFrontSway = useTransform(smoothScroll, (t) => scrollSwayFor("hair-front", t));
  const headSway = useTransform(smoothScroll, (t) => scrollSwayFor("head", t));
  const hatSway = useTransform(smoothScroll, (t) => scrollSwayFor("hat", t));
  const detailSway = useTransform(smoothScroll, (t) => scrollSwayFor("detail", t));
  const torsoSway = useTransform(smoothScroll, (t) => scrollSwayFor("torso", t));
  const armLeftSway = useTransform(smoothScroll, (t) => scrollSwayFor("arm-left", t));
  const armRightSway = useTransform(smoothScroll, (t) => scrollSwayFor("arm-right", t));
  const skirtSway = useTransform(smoothScroll, (t) => scrollSwayFor("skirt", t));
  const legLeftSway = useTransform(smoothScroll, (t) => scrollSwayFor("leg-left", t));
  const legRightSway = useTransform(smoothScroll, (t) => scrollSwayFor("leg-right", t));

  const groupSways = useMemo(
    () =>
      ({
        "hair-back": hairBackSway,
        "hair-front": hairFrontSway,
        head: headSway,
        hat: hatSway,
        detail: detailSway,
        torso: torsoSway,
        "arm-left": armLeftSway,
        "arm-right": armRightSway,
        skirt: skirtSway,
        "leg-left": legLeftSway,
        "leg-right": legRightSway,
      }) satisfies Record<ScrollMotionGroup, MotionValue<number>>,
    [
      armLeftSway,
      armRightSway,
      detailSway,
      hairBackSway,
      hairFrontSway,
      hatSway,
      headSway,
      legLeftSway,
      legRightSway,
      skirtSway,
      torsoSway,
    ]
  );

  const manifestById = useMemo(
    () => new Map(manifestFromShapes(pathDocument.shapes).map((entry) => [entry.id, entry])),
    [pathDocument.shapes]
  );

  const shapeOrder = useMemo(
    () => new Map(pathDocument.shapes.map((shape, index) => [shape.id, index])),
    [pathDocument.shapes]
  );

  const extraGroupNames = useMemo(
    () => Object.keys(groups).filter((name) => !KNOWN_GROUP_NAMES.has(name)),
    [groups]
  );

  const sortedGroupNames = useMemo(() => {
    const names = [
      ...DEFAULT_GROUP_PAINT_ORDER.filter((name) => name in groups),
      ...extraGroupNames,
    ];
    return sortGroupNamesByOrder(names, groupOrder);
  }, [extraGroupNames, groupOrder, groups]);

  const { groupedItems, motionPivotOrigins } = useMemo(() => {
    const byGroup = new Map<string, GroupItem[]>();
    const allNames = [...new Set([...DEFAULT_GROUP_PAINT_ORDER, ...Object.keys(groups)])];
    for (const name of allNames) byGroup.set(name, []);

    const labItems = expandShapesForLab(pathDocument.shapes, splits);
    const itemsById = new Map(labItems.map((item) => [item.id, item]));

    for (const name of allNames) {
      for (const id of groups[name] ?? []) {
        const labItem = itemsById.get(id);
        if (!labItem) continue;
        const parsed = parseSplitShapeId(id);
        byGroup.get(name)!.push({
          key: id,
          shape: labItem.shape,
          baseId: getBaseShapeId(id),
          clipPart: parsed?.part ?? null,
        });
      }
      byGroup.get(name)!.sort(
        (a, b) => (shapeOrder.get(a.baseId) ?? 0) - (shapeOrder.get(b.baseId) ?? 0)
      );
    }

    const pivotOrigins: Record<string, string> = {};
    for (const name of allNames) {
      pivotOrigins[name] = motionPivotOrigin(
        name,
        groups,
        armPivots,
        manifestById,
        splits
      );
    }

    return { groupedItems: byGroup, motionPivotOrigins: pivotOrigins };
  }, [
    armPivots,
    extraGroupNames,
    groups,
    manifestById,
    pathDocument.shapes,
    shapeOrder,
    splits,
  ]);

  const scene = useMemo(
    () =>
      renderCharacterScene({
        sortedGroupNames,
        getItems: (name) => groupedItems.get(name) ?? [],
        splits,
        motionPivotOrigins,
        armPivots,
        groupSways,
        groupMotion,
        scrollProgress: smoothScroll,
        motionDriver,
      }),
    [armPivots, groupedItems, groupMotion, groupSways, motionDriver, motionPivotOrigins, smoothScroll, sortedGroupNames, splits]
  );

  const switcherVisible = showSvgSwitcher && svgOptions.length > 1;

  if (!hydrated) {
    return <div className={className ?? "h-full w-full"} aria-hidden />;
  }

  return (
    <div
      className={`flex h-full min-h-0 w-full flex-col contain-layout contain-paint pb-2 ${className ?? ""}`}
    >
      <svg
        viewBox={pathDocument.viewBox}
        className="h-0 min-h-0 w-full flex-1"
        aria-label={activeSvgName}
        preserveAspectRatio="xMidYMid meet"
      >
        <style dangerouslySetInnerHTML={{ __html: pathDocument.styleCss }} />
        <defs>
          {Object.entries(splits).flatMap(([baseId, split]) =>
            (["a", "b"] as const).map((part) => (
              <clipPath
                key={splitClipPathId(baseId, part)}
                id={splitClipPathId(baseId, part)}
                clipPathUnits="userSpaceOnUse"
              >
                <polygon
                  points={clipPolygonPointsForPart(pathDocument.viewBox, split, part)}
                />
              </clipPath>
            ))
          )}
        </defs>

        {scene}
      </svg>

      <div className="mt-2 flex w-full shrink-0 items-center gap-2">
        {switcherVisible && (
          <button
            type="button"
            className="flex min-w-0 flex-[2] items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/90 px-2 py-1 text-[11px] leading-tight text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800"
            onClick={cycleSvg}
            title="Switch to next saved SVG"
          >
            <RefreshCw className="size-3 shrink-0" strokeWidth={2.5} />
            <span className="truncate">{activeSvgName}</span>
            <span className="shrink-0 text-zinc-500">
              ({svgOptions.findIndex((entry) => entry.id === activeSvgId) + 1}/{svgOptions.length})
            </span>
          </button>
        )}
        <Link
          href={labHref}
          className={`flex items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/90 px-2 py-1 text-[11px] leading-tight text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800 ${
            switcherVisible ? "flex-1" : "w-1/3"
          }`}
          title="Open animation path lab"
          target="_blank"
          rel="noopener noreferrer"
        >
          <FlaskConical className="size-3 shrink-0" strokeWidth={2.5} />
          <span className="truncate">Lab</span>
        </Link>
      </div>
    </div>
  );
}

export default LabSvgCharacter;
