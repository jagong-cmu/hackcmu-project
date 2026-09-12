import { useEffect, useRef, useState } from "react";
import { hitLabel, type HitGrade } from "./hitGrade.ts";

const HOLD_MS = 720;
const RANK: Record<HitGrade, number> = { okay: 1, good: 2, great: 3, perfect: 4 };

export function HitCallout({ grade }: { grade: HitGrade | null }) {
  const [shown, setShown] = useState<{ grade: HitGrade; id: number } | null>(null);
  const lastAt = useRef(0);
  const lastGrade = useRef<HitGrade | null>(null);

  useEffect(() => {
    if (!grade) return;
    const now = performance.now();
    const upgraded = RANK[grade] > RANK[lastGrade.current ?? "okay"] && lastGrade.current != null;
    if (!upgraded && now - lastAt.current < HOLD_MS) return;
    lastAt.current = now;
    lastGrade.current = grade;
    setShown({ grade, id: now });
  }, [grade]);

  useEffect(() => {
    if (!shown) return;
    const t = window.setTimeout(() => setShown(null), HOLD_MS);
    return () => clearTimeout(t);
  }, [shown]);

  if (!shown) return null;
  return (
    <p key={shown.id} className={`hit-callout hit-${shown.grade}`} role="status">
      {hitLabel(shown.grade)}
    </p>
  );
}
