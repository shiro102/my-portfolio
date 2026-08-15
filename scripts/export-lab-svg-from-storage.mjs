/**
 * Bake an animation-lab SVG into src/components/2D/assets/hoshino-new/.
 *
 * Preferred: in the lab, with Hoxilo (built-in) selected, click
 * "Download built-in dump" and save as scripts/lab-localStorage-dump.json
 *
 * Then: node scripts/export-lab-svg-from-storage.mjs
 *
 * Legacy: dump localStorage keys via --help snippet, then pass --name Hoxilo_New
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const LAB_SVG_LIBRARY_KEY = "animation-lab-svg-library";
const LAB_SESSIONS_KEY = "animation-lab-sessions";
const LAB_OVERRIDES_KEY = "animation-lab-default-shape-overrides";
const DEFAULT_SVG_ID = "hoshino-new-default";

const DEFAULT_INPUT = path.join(__dirname, "lab-localStorage-dump.json");
const DEFAULT_OUT = path.join(ROOT, "src/components/2D/assets/hoshino-new");

const BROWSER_EXPORT_SNIPPET = `
// Run on the animation-lab page, then save the downloaded file as:
// scripts/lab-localStorage-dump.json
(() => {
  const payload = {
    builtinDocument: undefined,
    [${JSON.stringify(LAB_SVG_LIBRARY_KEY)}]: localStorage.getItem(${JSON.stringify(LAB_SVG_LIBRARY_KEY)}),
    [${JSON.stringify(LAB_SESSIONS_KEY)}]: localStorage.getItem(${JSON.stringify(LAB_SESSIONS_KEY)}),
    [${JSON.stringify(LAB_OVERRIDES_KEY)}]: localStorage.getItem(${JSON.stringify(LAB_OVERRIDES_KEY)}),
  };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "lab-localStorage-dump.json";
  a.click();
  URL.revokeObjectURL(url);
  console.log("Downloaded lab-localStorage-dump.json");
})();
`.trim();

function parseArgs(argv) {
  const opts = {
    input: DEFAULT_INPUT,
    out: DEFAULT_OUT,
    name: null,
    builtin: true,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--input" || arg === "-i") {
      opts.input = path.resolve(argv[++i]);
    } else if (arg === "--out" || arg === "-o") {
      opts.out = path.resolve(argv[++i]);
    } else if (arg === "--name" || arg === "-n") {
      opts.name = argv[++i];
      opts.builtin = false;
    } else if (arg === "--builtin") {
      opts.builtin = true;
      opts.name = null;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return opts;
}

function printHelp() {
  console.log(`Usage: node scripts/export-lab-svg-from-storage.mjs [options]

Options:
  -i, --input <file>   dump JSON (default: scripts/lab-localStorage-dump.json)
  -o, --out <dir>      output directory (default: src/components/2D/assets/hoshino-new)
      --builtin        export the edited Hoxilo built-in (default)
  -n, --name <name>    export a saved-library SVG by name instead
  -h, --help           show this help

Browser export snippet (DevTools console on animation-lab page):
${BROWSER_EXPORT_SNIPPET}
`);
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Input file not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseOptionalStorage(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") return JSON.parse(raw);
  return raw;
}

function manifestFromShapes(shapes) {
  return shapes.map(({ id, tag, className, x, y }) => ({
    id,
    tag,
    className,
    x,
    y,
  }));
}

function sanitizeMotion(motion) {
  if (!motion || typeof motion !== "object") return {};
  const next = {};
  for (const [key, value] of Object.entries(motion)) {
    if (value && typeof value === "object" && "peakDeg" in value) {
      next[key] = value;
    }
  }
  return next;
}

function applyShapeOverrides(shapes, overrides) {
  if (!overrides || typeof overrides !== "object") return shapes;
  return shapes.map((shape) => {
    const patch = overrides[shape.id];
    if (!patch) return shape;
    return {
      ...shape,
      ...(patch.attrs ? { attrs: { ...shape.attrs, ...patch.attrs } } : {}),
      ...(patch.silhouetteD !== undefined ? { silhouetteD: patch.silhouetteD } : {}),
      ...(patch.paintLayers !== undefined ? { paintLayers: patch.paintLayers } : {}),
    };
  });
}

function findSavedSvg(library, name) {
  const exact = library.find((entry) => entry.name === name);
  if (exact) return exact;

  const normalized = name.trim().toLowerCase();
  const fuzzy = library.filter(
    (entry) => entry.name.trim().toLowerCase() === normalized
  );
  if (fuzzy.length === 1) return fuzzy[0];

  const available = library.map((entry) => entry.name).join(", ") || "(none)";
  throw new Error(
    `Saved SVG "${name}" not found in ${LAB_SVG_LIBRARY_KEY}. Available: ${available}`
  );
}

function writeAssets(outDir, { viewBox, styleCss, shapes, groups, session }) {
  const pathsJson = { viewBox, styleCss: styleCss ?? "", shapes };
  const manifestJson = manifestFromShapes(shapes);
  const groupsJson = { viewBox, groups };
  const labSessionJson = {
    groupOrder: session.groupOrder,
    splits: session.splits ?? {},
    pivots: session.pivots ?? {},
    motion: sanitizeMotion(session.motion),
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "paths.json"), JSON.stringify(pathsJson, null, 2));
  fs.writeFileSync(
    path.join(outDir, "path-manifest.json"),
    JSON.stringify(manifestJson, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "path-groups.json"),
    JSON.stringify(groupsJson, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "lab-session.json"),
    JSON.stringify(labSessionJson, null, 2)
  );

  return { manifestJson, labSessionJson };
}

function resolveBuiltinExport(dump, outDir) {
  const inlineDocument = dump.builtinDocument;
  const inlineSession = dump.builtinSession;
  if (inlineDocument?.shapes?.length && inlineSession?.groups) {
    return {
      document: inlineDocument,
      session: inlineSession,
    };
  }

  const sessions = parseOptionalStorage(dump[LAB_SESSIONS_KEY]) ?? {};
  const session = sessions[DEFAULT_SVG_ID];
  if (!session?.groups) {
    throw new Error(
      `No built-in session found. Use "Download built-in dump" in the lab, or dump localStorage with key ${DEFAULT_SVG_ID}.`
    );
  }

  const existingPaths = path.join(outDir, "paths.json");
  if (!fs.existsSync(existingPaths)) {
    throw new Error(`Missing ${existingPaths}; cannot apply shape overrides without a base paths.json`);
  }
  const document = JSON.parse(fs.readFileSync(existingPaths, "utf8"));
  const overrides = parseOptionalStorage(dump[LAB_OVERRIDES_KEY]) ?? {};
  return {
    document: {
      ...document,
      shapes: applyShapeOverrides(document.shapes, overrides),
    },
    session,
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const dump = readJsonFile(opts.input);
  let document;
  let session;
  let label;

  if (opts.builtin) {
    const resolved = resolveBuiltinExport(dump, opts.out);
    document = resolved.document;
    session = resolved.session;
    label = "Hoxilo (built-in)";
  } else {
    const library = parseOptionalStorage(dump[LAB_SVG_LIBRARY_KEY]);
    if (!Array.isArray(library)) {
      throw new Error(`${LAB_SVG_LIBRARY_KEY} must be an array`);
    }
    const saved = findSavedSvg(library, opts.name);
    session = (parseOptionalStorage(dump[LAB_SESSIONS_KEY]) ?? {})[saved.id];
    if (!session?.groups) {
      throw new Error(
        `No session groups found for "${saved.name}" (id: ${saved.id}). Open it once in the lab so groups are saved.`
      );
    }
    document = saved.document;
    label = saved.name;
  }

  const { viewBox, styleCss, shapes } = document;
  if (!viewBox || !Array.isArray(shapes) || !shapes.length) {
    throw new Error(`"${label}" has no path document`);
  }

  const { manifestJson } = writeAssets(opts.out, {
    viewBox,
    styleCss,
    shapes,
    groups: session.groups,
    session,
  });

  console.log(`Exported "${label}" → ${path.relative(ROOT, opts.out)}/`);
  console.log(`  paths.json          ${shapes.length} shapes`);
  console.log(`  path-manifest.json  ${manifestJson.length} entries`);
  console.log(
    `  path-groups.json      ${Object.keys(session.groups).length} groups, ${Object.values(session.groups).flat().length} path refs`
  );
  console.log(
    `  lab-session.json      ${Object.keys(session.splits ?? {}).length} splits, ${Object.keys(session.pivots ?? {}).length} pivot groups`
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error("\nRun with --help for the browser export snippet.");
  process.exit(1);
}
