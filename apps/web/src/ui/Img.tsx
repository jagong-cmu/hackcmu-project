import { useState, type ImgHTMLAttributes } from "react";

/**
 * An image slot for the files in assets.ts. If the file is missing or fails
 * to load, it renders nothing at all: no placeholder art, no broken icon, so
 * layouts must not depend on it being there.
 */
export function Img({ src, alt = "", ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src) return null;
  return <img src={src} alt={alt} decoding="async" onError={() => setFailed(src)} {...rest} />;
}
