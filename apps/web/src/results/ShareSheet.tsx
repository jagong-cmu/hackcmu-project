import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  canNativeShare,
  copyImage,
  downloadBlob,
  nativeShare,
} from "./composeShareImage.ts";
import { capture } from "../analytics/posthog.ts";

type Props = {
  url: string;
  blob: Blob;
  filename: string;
  kind: "video" | "image";
  title: string;
  text: string;
  copied: boolean;
  onCopied: () => void;
  onClose: () => void;
};

export function ShareSheet({
  url,
  blob,
  filename,
  kind,
  title,
  text,
  copied,
  onCopied,
  onClose,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const file = new File([blob], filename, { type: blob.type || (kind === "video" ? "video/webm" : "image/png") });
  const native = canNativeShare(file);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="modal-scrim share-scrim" onClick={onClose}>
      <div
        className="share-sheet"
        role="dialog"
        aria-labelledby="share-title"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="share-title">{kind === "video" ? "The take" : "Send this to a friend"}</h2>
        {kind === "video" ? (
          <video className="share-card" src={url} controls playsInline preload="metadata" />
        ) : (
          <img className="share-card" src={url} alt={title} />
        )}
        <div className="share-actions">
          {native ? (
            <button
              type="button"
              className="cta"
              onClick={() => {
                void nativeShare(file, title, text);
                capture("share clicked", { kind, method: "native" });
              }}
            >
              Share
            </button>
          ) : null}
          {kind === "image" ? (
            <button
              type="button"
              className="cta cta-ghost"
              onClick={() => {
                void copyImage(blob).then((ok) => {
                  if (ok) onCopied();
                  else downloadBlob(blob, filename);
                });
                capture("share clicked", { kind, method: "copy" });
              }}
            >
              {copied ? "Copied" : "Copy image"}
            </button>
          ) : null}
          <button
            type="button"
            className="cta cta-ghost"
            onClick={() => {
              downloadBlob(blob, filename);
              capture("share clicked", { kind, method: "download" });
            }}
          >
            Download
          </button>
          <button type="button" className="cta cta-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
