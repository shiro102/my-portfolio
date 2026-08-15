import fs from "fs";

const svg = fs.readFileSync("Sample game design/Hoshino_vector1.svg", "utf8");
const outFile = "src/components/2D/components/HoshinoCharacter.tsx";

const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 2048 2048";

const defsMatch = svg.match(/<defs>([\s\S]*?)<\/defs>/);
const defsInner = defsMatch ? defsMatch[1] : "";
const styleMatch = defsInner.match(/<style>([\s\S]*?)<\/style>/);
const styleCss = styleMatch ? styleMatch[1].trim() : "";
const styleBlock = styleCss
  ? `          <style dangerouslySetInnerHTML={{ __html: ${JSON.stringify(styleCss)} }} />`
  : "";

const generativeMatch = svg.match(/<g id="Generative_Object">([\s\S]*?)<\/g>\s*<\/svg>/);
let artContent = generativeMatch ? generativeMatch[1].trim() : "";
// Drop full-canvas background rect
artContent = artContent.replace(/<rect class="st865" width="2048" height="2048"\/>/, "").trim();
artContent = artContent.replace(/\bclass="/g, 'className="');

// Parallax bands for 2048×2048 art (synthetic clip slices)
const bands = [
  { id: "hoshino-band-body", kind: "body", y: 0, h: 1500, rotate: "bodyLean", origin: "1024px 1100px" },
  { id: "hoshino-band-head", kind: "head", y: 450, h: 750, rotate: "headSway", origin: "1024px 700px" },
  { id: "hoshino-band-hat", kind: "hat", y: 0, h: 650, rotate: "hatSway", origin: "1024px 420px" },
  { id: "hoshino-band-lower", kind: "lower", y: 1200, h: 848, rotate: "lowerSway", origin: "1024px 1650px" },
  { id: "hoshino-band-detail", kind: "detail", y: 1350, h: 698, rotate: "detailSway", origin: "1024px 1750px" },
];

const clipDefs = bands
  .map(
    (b) =>
      `    <clipPath id="${b.id}"><rect x="0" y="${b.y}" width="2048" height="${b.h}"/></clipPath>`
  )
  .join("\n");

const layerBlocks = bands
  .map(
    (b) => `        <motion.g
          id="${b.kind}"
          clipPath="url(#${b.id})"
          style={{
            rotate: ${b.rotate},
            transformOrigin: "${b.origin}",
          }}
        >
          <use href="#hoshino-art" width="2048" height="2048" />
        </motion.g>`
  )
  .join("\n");

const component = `"use client";

import { motion, MotionValue, useTransform } from "framer-motion";

export type HoshinoLayerKind = "body" | "head" | "hat" | "lower" | "detail";

type HoshinoCharacterProps = {
  scrollYProgress: MotionValue<number>;
  className?: string;
};

/**
 * Hoshino character from Hoshino_vector1.svg.
 * Scroll parallax uses synthetic horizontal clip bands over a single art symbol.
 */
const HoshinoCharacter = ({ scrollYProgress, className }: HoshinoCharacterProps) => {
  const bodyLean = useTransform(scrollYProgress, [0, 1], [0, 2]);
  const headSway = useTransform(scrollYProgress, [0, 1], [0, 5]);
  const hatSway = useTransform(scrollYProgress, [0, 1], [0, 7]);
  const lowerSway = useTransform(scrollYProgress, [0, 1], [0, 4]);
  const detailSway = useTransform(scrollYProgress, [0, 1], [0, 8]);

  return (
    <div className={className ?? "w-full h-full"}>
      <svg
        viewBox="${viewBox}"
        width="100%"
        height="100%"
        aria-label="Hoshino character"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
${styleBlock}
${clipDefs}
          <symbol id="hoshino-art" viewBox="${viewBox}">
${artContent}
          </symbol>
        </defs>
${layerBlocks}
      </svg>
    </div>
  );
};

export default HoshinoCharacter;
`;

fs.writeFileSync(outFile, component);
console.log(`Wrote ${outFile} (${component.length} bytes, ${bands.length} parallax bands)`);
