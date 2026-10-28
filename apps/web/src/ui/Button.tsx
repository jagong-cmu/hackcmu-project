import type { ButtonHTMLAttributes } from "react";
import "./ui.css";

/**
 * Primary: solid red, white text; one per screen. Secondary: outline on
 * surface. Ghost: text only. Disabled via the native `disabled` prop.
 * Styles: .ui-btn in ui/ui.css (prefixed so the legacy .btn link style
 * in index.css and theme.css cannot leak in).
 */
export function Button({
  variant = "secondary",
  type = "button",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  return <button type={type} className={`ui-btn ui-btn-${variant}${className ? ` ${className}` : ""}`} {...rest} />;
}
