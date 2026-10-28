import { useEffect, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { KeyHintBar } from "../ui/KeyHints.tsx";

type Props = {
  title: string;
  tag?: string;
  wide?: boolean;
  /** No surface: the page lays its own content straight over the room (Training, legal text). */
  bare?: boolean;
  children: ReactNode;
  /** Extra class on <main>, e.g. training. */
  className?: string;
  onHome?: () => void;
};

/**
 * Shared chrome for every inner page: plain left-aligned text over the room,
 * one dark translucent panel for content that needs a surface, and an Esc hint.
 * Quiet by design: no ambient motion.
 */
export function PageShell({ title, tag, wide, bare, children, className, onHome }: Props) {
  const navigate = useNavigate();

  // Esc goes back (to the main menu), unless a field or control inside has already used it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
      onHome?.();
      navigate("/");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, onHome]);

  return (
    <main className={["page shell", className ?? ""].filter(Boolean).join(" ")}>
      {/* Title upper-left, the way back under it. */}
      <header className="page-head">
        <h1>{title}</h1>
        <Link to="/" className="back" onClick={onHome}>
          Home
        </Link>
      </header>
      <div className={["shell-inner", wide ? "wide" : "", bare ? "bare" : ""].filter(Boolean).join(" ")}>
        {tag ? <p className="tag">{tag}</p> : null}
        {children}
      </div>
      <KeyHintBar hints={[{ keys: ["Esc"], label: "Back" }]} />
    </main>
  );
}
