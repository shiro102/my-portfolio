import type { ComponentProps, CSSProperties } from "react";
import { splitPathSegments } from "@/components/2D/utils/charShapePaint";

type FilledPathGeometryProps = Omit<ComponentProps<"path">, "d"> & {
  d: string;
  transform?: string;
};

/** Render each moveto subpath separately so overlapping fills union instead of cancelling. */
export function FilledPathGeometry({
  d,
  transform,
  style,
  id,
  clipPath,
  fillRule,
  ...rest
}: FilledPathGeometryProps) {
  const rule = fillRule ?? (style?.fillRule as string | undefined) ?? "nonzero";
  if (rule === "evenodd") {
    return (
      <path
        d={d}
        transform={transform}
        id={id}
        clipPath={clipPath}
        fillRule="evenodd"
        style={style}
        {...rest}
      />
    );
  }

  const segments = splitPathSegments(d);
  if (segments.length === 0) return null;

  const fillStyle: CSSProperties = { ...style, fillRule: "nonzero" };

  if (segments.length === 1) {
    return (
      <path
        d={segments[0]}
        transform={transform}
        id={id}
        clipPath={clipPath}
        {...rest}
        style={fillStyle}
      />
    );
  }

  return (
    <g transform={transform} id={id} clipPath={clipPath}>
      {segments.map((segment, index) => (
        <path key={index} d={segment} {...rest} style={fillStyle} />
      ))}
    </g>
  );
}
