import type { ReactNode } from "react";
import { Link } from "react-router-dom";

type Props = {
  title: string;
  tag?: string;
  wide?: boolean;
  children: ReactNode;
  /** Extra class on <main>, e.g. training. */
  className?: string;
  onHome?: () => void;
};

/** Shared chrome for every inner page: back link and a centred column. Quiet by design: no ambient motion. */
export function PageShell({ title, tag, wide, children, className, onHome }: Props) {
  return (
    <main className={["page bloom-page shell", className ?? ""].filter(Boolean).join(" ")}>
      {/* Title upper-left, the way back under it. */}
      <header className="page-head">
        <h1>{title}</h1>
        <Link to="/" className="back" onClick={onHome}>
          Home
        </Link>
      </header>
      <div className={wide ? "shell-inner wide" : "shell-inner"}>
        {tag ? <p className="tag">{tag}</p> : null}
        {children}
      </div>
    </main>
  );
}
