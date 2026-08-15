// "use client";

// import { useEffect, useMemo, useState } from "react";
// import {
//   motion,
//   MotionValue,
//   useSpring,
//   useTransform,
//   type MotionStyle,
// } from "framer-motion";
// import pathsData from "@/components/2D/assets/hoshino/paths.json";
// import defaultGroups from "@/components/2D/assets/hoshino/path-groups.json";
// import manifest from "@/components/2D/assets/hoshino/path-manifest.json";
// import { readStoredGroups } from "@/components/2D/utils/charPathGroups";
// import {
//   clipPolygonPointsForPart,
//   getBaseShapeId,
//   parseSplitShapeId,
//   readStoredSplits,
//   splitClipPathId,
//   type PathSplit,
//   type SplitPart,
// } from "@/components/2D/utils/charPathSplits";
// import {
//   getArmPivotPathId,
//   parsePivotOrigin,
//   readStoredPivots,
//   resolveArmPivotOrigin,
//   type ArmPivotConfig,
// } from "@/components/2D/utils/charPathPivots";
// import { ArmHingeGroup } from "@/components/2D/components/ArmHingeGroup";
// import {
//   armBoneScaleFromRotation,
//   armWidthScaleFromBoneScale,
// } from "@/components/2D/utils/charArmMotion";
// import {
//   computeCentroidPivot,
//   computeHeadCrownPivot,
//   computeHipPivot,
//   computeNeckPivot,
//   pivotPx,
// } from "@/components/2D/utils/charMotionPivots";

// type Shape = (typeof pathsData)["shapes"][number];
// type GroupName = keyof typeof defaultGroups.groups;

// type GroupItem = {
//   key: string;
//   shape: Shape;
//   baseId: string;
//   clipPart: SplitPart | null;
// };

// export type HoshinoLayerKind = GroupName;

// type HoshinoCharacterProps = {
//   scrollYProgress: MotionValue<number>;
//   className?: string;
// };

// /** Back → front. Hair-back behind body; hair-front over arms, under head. Hat nested on head. */
// const PAINT_ORDER: GroupName[] = [
//   "hair-back",
//   "leg-left",
//   "leg-right",
//   "skirt",
//   "torso",
//   "arm-left",
//   "arm-right",
//   "hair-front",
//   "head",
//   "detail",
// ];

// const HIERARCHY_GROUPS = new Set<GroupName>([
//   "hair-back",
//   "leg-left",
//   "leg-right",
//   "skirt",
//   "torso",
//   "arm-left",
//   "arm-right",
//   "hair-front",
//   "head",
//   "hat",
//   "detail",
// ]);

// /** Max degrees at full scroll — kept subtle for a natural idle sway. */
// const MOTION = {
//   torso: 1.2,
//   head: 4,
//   hatBob: 1.5,
//   hairBack: 0.8,
//   hairFront: 0.8,
//   armLeft: 3.5,
//   armRight: 3.5,
//   skirt: 2,
//   leg: 1,
//   detail: 2,
// } as const;

// const SPRING = { stiffness: 90, damping: 26, mass: 0.45, restDelta: 0.001 };

// function renderShapeGeometry(
//   shape: Shape,
//   clipPart: SplitPart | null,
//   splits: Record<string, PathSplit>
// ) {
//   const split = splits[shape.id];
//   const clipId =
//     clipPart && split ? splitClipPathId(shape.id, clipPart) : undefined;
//   const clipProps = clipId ? { clipPath: `url(#${clipId})` } : {};

//   const { attrs } = shape;
//   if (shape.tag === "path" && attrs.d) {
//     return (
//       <path
//         d={attrs.d}
//         transform={attrs.transform}
//         className={shape.className}
//         {...clipProps}
//       />
//     );
//   }
//   if (shape.tag === "polygon" && attrs.points) {
//     return (
//       <polygon
//         points={attrs.points}
//         transform={attrs.transform}
//         className={shape.className}
//         {...clipProps}
//       />
//     );
//   }
//   if (shape.tag === "rect" && attrs.x != null) {
//     return (
//       <rect
//         x={attrs.x}
//         y={attrs.y}
//         width={attrs.width}
//         height={attrs.height}
//         transform={attrs.transform}
//         className={shape.className}
//         {...clipProps}
//       />
//     );
//   }
//   return null;
// }

// function ShapeList({
//   items,
//   splits,
// }: {
//   items: GroupItem[];
//   splits: Record<string, PathSplit>;
// }) {
//   return (
//     <>
//       {items.map((item) => (
//         <g key={item.key}>
//           {renderShapeGeometry(item.shape, item.clipPart, splits)}
//         </g>
//       ))}
//     </>
//   );
// }

// function MotionLayer({
//   id,
//   items,
//   splits,
//   rotate,
//   transformOrigin,
// }: {
//   id: string;
//   items: GroupItem[];
//   splits: Record<string, PathSplit>;
//   rotate: MotionValue<number>;
//   transformOrigin: string;
// }) {
//   if (items.length === 0) return null;

//   const style: MotionStyle = { rotate, transformOrigin };

//   return (
//     <motion.g id={id} style={style}>
//       <ShapeList items={items} splits={splits} />
//     </motion.g>
//   );
// }

// function ArmMotionLayer({
//   id,
//   items,
//   splits,
//   rotate,
//   pivotOrigin,
//   pivotPathId,
// }: {
//   id: string;
//   items: GroupItem[];
//   splits: Record<string, PathSplit>;
//   rotate: MotionValue<number>;
//   pivotOrigin: string;
//   pivotPathId?: string;
// }) {
//   if (items.length === 0) return null;

//   const { x: cx, y: cy } = parsePivotOrigin(pivotOrigin);
//   const staticItems = pivotPathId
//     ? items.filter((item) => item.key === pivotPathId)
//     : [];
//   const rotatingItems = pivotPathId
//     ? items.filter((item) => item.key !== pivotPathId)
//     : items;

//   const scaleX = useTransform(rotate, (deg) => armBoneScaleFromRotation(deg));
//   const scaleY = useTransform(scaleX, (sx) => armWidthScaleFromBoneScale(sx));

//   return (
//     <g id={id}>
//       <ShapeList items={staticItems} splits={splits} />
//       {rotatingItems.length > 0 && (
//         <ArmHingeGroup
//           cx={cx}
//           cy={cy}
//           liveMotion={{ rotate, scaleX, scaleY }}
//         >
//           <ShapeList items={rotatingItems} splits={splits} />
//         </ArmHingeGroup>
//       )}
//     </g>
//   );
// }

// const HoshinoCharacter = ({ scrollYProgress, className }: HoshinoCharacterProps) => {
//   const [groups, setGroups] = useState<Record<string, string[]>>(defaultGroups.groups);
//   const [splits, setSplits] = useState<Record<string, PathSplit>>({});
//   const [armPivots, setArmPivots] = useState<ArmPivotConfig>({});

//   useEffect(() => {
//     setGroups(readStoredGroups());
//     setSplits(readStoredSplits());
//     setArmPivots(readStoredPivots());
//   }, []);

//   const smoothScroll = useSpring(scrollYProgress, SPRING);

//   const torsoSway = useTransform(smoothScroll, [0, 0.45, 1], [0, MOTION.torso * 0.6, MOTION.torso]);
//   const headSway = useTransform(smoothScroll, [0, 0.45, 1], [0, MOTION.head * 0.55, MOTION.head]);
//   const hatBob = useTransform(smoothScroll, [0, 0.5, 1], [0, MOTION.hatBob * 0.5, MOTION.hatBob]);
//   const hairBackSway = useTransform(
//     headSway,
//     (h) => h * (MOTION.hairBack / MOTION.head)
//   );
//   const hairFrontSway = useTransform(
//     headSway,
//     (h) => h * (MOTION.hairFront / MOTION.head)
//   );
//   const armLeftSway = useTransform(smoothScroll, [0, 0.5, 1], [0, MOTION.armLeft * 0.5, MOTION.armLeft]);
//   const armRightSway = useTransform(smoothScroll, [0, 0.5, 1], [0, -MOTION.armRight * 0.5, -MOTION.armRight]);
//   const skirtSway = useTransform(smoothScroll, [0, 0.5, 1], [0, MOTION.skirt * 0.5, MOTION.skirt]);
//   const legLeftSway = useTransform(smoothScroll, [0, 1], [0, MOTION.leg]);
//   const legRightSway = useTransform(smoothScroll, [0, 1], [0, -MOTION.leg]);
//   const detailSway = useTransform(smoothScroll, [0, 0.5, 1], [0, MOTION.detail * 0.4, MOTION.detail]);

//   const shapesById = useMemo(
//     () => new Map(pathsData.shapes.map((shape) => [shape.id, shape])),
//     []
//   );

//   const shapeOrder = useMemo(
//     () => new Map(pathsData.shapes.map((shape, index) => [shape.id, index])),
//     []
//   );

//   const manifestById = useMemo(
//     () => new Map(manifest.map((entry) => [entry.id, entry])),
//     []
//   );

//   const extraGroupNames = useMemo(
//     () => Object.keys(groups).filter((name) => !HIERARCHY_GROUPS.has(name as GroupName)),
//     [groups]
//   );

//   const { groupedItems, pivots } = useMemo(() => {
//     const byGroup = new Map<string, GroupItem[]>();
//     const allNames = [...PAINT_ORDER, "hat", ...extraGroupNames];

//     for (const name of allNames) byGroup.set(name, []);

//     for (const name of allNames) {
//       for (const id of groups[name] ?? []) {
//         const parsed = parseSplitShapeId(id);
//         const baseId = parsed?.baseId ?? id;
//         const shape = shapesById.get(baseId);
//         if (!shape) continue;
//         byGroup.get(name)!.push({
//           key: id,
//           shape,
//           baseId,
//           clipPart: parsed?.part ?? null,
//         });
//       }
//       byGroup.get(name)!.sort(
//         (a, b) => (shapeOrder.get(a.baseId) ?? 0) - (shapeOrder.get(b.baseId) ?? 0)
//       );
//     }

//     const uniqueBaseIds = (name: string) =>
//       [...new Set((groups[name] ?? []).map(getBaseShapeId))];
//     const ids = uniqueBaseIds;
//     const headIds = ids("head");

//     const pivots = {
//       torso: pivotPx(1024, 1180),
//       neck: computeNeckPivot(headIds, manifestById),
//       crown: computeHeadCrownPivot(headIds, manifestById),
//       armLeft: resolveArmPivotOrigin(
//         "arm-left",
//         armPivots["arm-left"],
//         ids("arm-left"),
//         manifestById,
//         splits
//       ),
//       armRight: resolveArmPivotOrigin(
//         "arm-right",
//         armPivots["arm-right"],
//         ids("arm-right"),
//         manifestById,
//         splits
//       ),
//       skirt: computeCentroidPivot(ids("skirt"), manifestById),
//       legLeft: computeHipPivot(ids("leg-left"), manifestById, "left"),
//       legRight: computeHipPivot(ids("leg-right"), manifestById, "right"),
//     };

//     return { groupedItems: byGroup, pivots };
//   }, [armPivots, extraGroupNames, groups, manifestById, shapeOrder, shapesById, splits]);

//   const getItems = (name: string) => groupedItems.get(name) ?? [];

//   return (
//     <div className={className ?? "w-full h-full"}>
//       <svg
//         viewBox={pathsData.viewBox}
//         width="100%"
//         height="100%"
//         aria-label="Hoshino character"
//         preserveAspectRatio="xMidYMid meet"
//       >
//         <style dangerouslySetInnerHTML={{ __html: pathsData.styleCss }} />
//         <defs>
//           {Object.entries(splits).flatMap(([baseId, split]) =>
//             (["a", "b"] as const).map((part) => (
//               <clipPath key={splitClipPathId(baseId, part)} id={splitClipPathId(baseId, part)} clipPathUnits="userSpaceOnUse">
//                 <polygon
//                   points={clipPolygonPointsForPart(pathsData.viewBox, split, part)}
//                 />
//               </clipPath>
//             ))
//           )}
//         </defs>

//         <MotionLayer
//           id="hair-back"
//           items={getItems("hair-back")}
//           splits={splits}
//           rotate={hairBackSway}
//           transformOrigin={pivots.neck}
//         />
//         <MotionLayer
//           id="leg-left"
//           items={getItems("leg-left")}
//           splits={splits}
//           rotate={legLeftSway}
//           transformOrigin={pivots.legLeft}
//         />
//         <MotionLayer
//           id="leg-right"
//           items={getItems("leg-right")}
//           splits={splits}
//           rotate={legRightSway}
//           transformOrigin={pivots.legRight}
//         />
//         <MotionLayer
//           id="skirt"
//           items={getItems("skirt")}
//           splits={splits}
//           rotate={skirtSway}
//           transformOrigin={pivots.skirt}
//         />

//         <MotionLayer
//           id="torso"
//           items={getItems("torso")}
//           splits={splits}
//           rotate={torsoSway}
//           transformOrigin={pivots.torso}
//         />

//         <ArmMotionLayer
//           id="arm-left"
//           items={getItems("arm-left")}
//           splits={splits}
//           rotate={armLeftSway}
//           pivotOrigin={pivots.armLeft}
//           pivotPathId={getArmPivotPathId(armPivots, "arm-left")}
//         />
//         <ArmMotionLayer
//           id="arm-right"
//           items={getItems("arm-right")}
//           splits={splits}
//           rotate={armRightSway}
//           pivotOrigin={pivots.armRight}
//           pivotPathId={getArmPivotPathId(armPivots, "arm-right")}
//         />

//         <MotionLayer
//           id="hair-front"
//           items={getItems("hair-front")}
//           splits={splits}
//           rotate={hairFrontSway}
//           transformOrigin={pivots.neck}
//         />

//         {/* Head + hat nested so the hat inherits head motion and bobs slightly on the crown */}
//         {(getItems("head").length > 0 || getItems("hat").length > 0) && (
//           <motion.g
//             id="head"
//             style={{ rotate: headSway, transformOrigin: pivots.neck }}
//           >
//             <ShapeList items={getItems("head")} splits={splits} />
//             <MotionLayer
//               id="hat"
//               items={getItems("hat")}
//               splits={splits}
//               rotate={hatBob}
//               transformOrigin={pivots.crown}
//             />
//           </motion.g>
//         )}

//         <MotionLayer
//           id="detail"
//           items={getItems("detail")}
//           splits={splits}
//           rotate={detailSway}
//           transformOrigin={pivots.neck}
//         />

//         {extraGroupNames.map((name) => (
//           <g key={name} id={name}>
//             <ShapeList items={getItems(name)} splits={splits} />
//           </g>
//         ))}
//       </svg>
//     </div>
//   );
// };

// export default HoshinoCharacter;
