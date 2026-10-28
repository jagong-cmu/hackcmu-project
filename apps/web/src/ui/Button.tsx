import type { ButtonHTMLAttributes } from "react";

/**
 * Primary: solid red, white text; one per screen. Secondary: outline on
 * surface. Ghost: text only. Disabled via the native `disabled` prop.
 * Styles: .btn in theme/components.css.
 */
export function Button({
  variant = "secondary",
  type = "button",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  return <button type={type} className={`btn btn-${variant}${className ? ` ${className}` : ""}`} {...rest} />;
}
