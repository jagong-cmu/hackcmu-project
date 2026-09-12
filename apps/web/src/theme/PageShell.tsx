import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bloom } from "./Bloom.tsx";
import { VoiceWave } from "./VoiceWave.tsx";

type Props = {
  title: string;
  tag?: string;
  wide?: boolean;
  children: ReactNode;
  /** Extra class on <main>, e.g. training. */
  className?: string;
  onHome?: () => void;
  stream?: MediaStream | null;
  level?: number;
  quietWave?: boolean;
};

/** Shared chrome for every inner page: bloom, voice wave, back link, centred column. */
export function PageShell({ title, tag, wide, children, className, onHome, stream, level, quietWave }: Props) {
  return (
    <main className={["page bloom-page shell", className ?? ""].filter(Boolean).join(" ")}>
      <Bloom />
      <VoiceWave stream={stream} level={level} className={quietWave ? "quiet" : undefined} />
      <Link to="/" className="back" onClick={onHome}>
        Home
      </Link>
      <div className={wide ? "shell-inner wide" : "shell-inner"}>
        <h1>{title}</h1>
        {tag ? <p className="tag">{tag}</p> : null}
        {children}
      </div>
    </main>
  );
}
