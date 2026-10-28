import type { HTMLAttributes } from "react";
import "./ui.css";

/** A surface: --surface fill, --line border, --r-lg radius. Nest nothing in another Panel. */
export function Panel({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`panel${className ? ` ${className}` : ""}`} {...rest} />;
}
