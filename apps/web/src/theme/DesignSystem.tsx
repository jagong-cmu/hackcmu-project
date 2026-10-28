import { useEffect, useState } from "react";
import { Button } from "../ui/Button.tsx";
import { Digits } from "../ui/Digits.tsx";
import { Img } from "../ui/Img.tsx";
import { Images } from "../ui/assets.ts";
import { KeyHint } from "../ui/KeyHints.tsx";
import { Panel } from "../ui/Panel.tsx";
import { SelectableList } from "../ui/SelectableList.tsx";

/**
 * Dev-only reference page (`/system`): every token, type role and shared
 * component in one place, for visual review by the screen sessions.
 * Not routed in production builds. Docs: docs/design-system.md.
 */
const SWATCHES = ["bg", "surface", "surface-2", "text", "muted", "red", "red-text", "blue", "blue-text", "ice"];

const ROLES: [string, string][] = [
  ["t-logo", "Aria"],
  ["t-title", "Training"],
  ["t-menu", "Ranked"],
  ["t-menu-2", "Leaderboard"],
  ["t-score", "87"],
  ["t-num", "001"],
  ["t-tab", "Duet"],
  ["t-lyric", "When you were here before"],
  ["t-lyric-next", "Couldn't look you in the eye"],
  ["t-desc", "1v1. The same chorus, you then them. Winner takes casual Elo."],
  ["t-body", "Body copy, Hanken Grotesk 400, at a comfortable measure."],
  ["t-song", "Viva la Vida"],
  ["t-label", "Coming up"],
];

const noop = () => {};

export function DesignSystem() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setN((x) => (x + 7) % 120), 400);
    return () => window.clearInterval(id);
  }, []);

  return (
    <main style={{ padding: "var(--sp-7)", display: "grid", gap: "var(--sp-7)", maxWidth: "72rem", margin: "0 auto" }}>
      <h1 className="t-title" style={{ margin: 0 }}>Design system</h1>

      <section aria-labelledby="ds-color">
        <h2 id="ds-color" className="t-label" style={{ color: "var(--muted)" }}>Colour</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "var(--sp-3)" }}>
          {SWATCHES.map((s) => (
            <div key={s}>
              <div style={{ height: "3.5rem", background: `var(--${s})`, border: "1px solid var(--line)", borderRadius: "var(--r-md)" }} />
              <code className="t-body" style={{ color: "var(--muted)" }}>--{s}</code>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="ds-type">
        <h2 id="ds-type" className="t-label" style={{ color: "var(--muted)" }}>Type roles</h2>
        <div style={{ display: "grid", gap: "var(--sp-4)" }}>
          {ROLES.map(([cls, sample]) => (
            <div key={cls} style={{ display: "grid", gridTemplateColumns: "9rem 1fr", alignItems: "baseline", gap: "var(--sp-4)" }}>
              <code className="t-body" style={{ color: "var(--muted)" }}>.{cls}</code>
              <span className={cls}>{sample}</span>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="ds-btn">
        <h2 id="ds-btn" className="t-label" style={{ color: "var(--muted)" }}>Button</h2>
        <div style={{ display: "flex", gap: "var(--sp-4)", flexWrap: "wrap", alignItems: "center" }}>
          <Button variant="primary">Find a match</Button>
          <Button>Enter a code</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="primary" disabled>Disabled</Button>
        </div>
      </section>

      <section aria-labelledby="ds-list" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-6)" }}>
        <h2 id="ds-list" className="t-label" style={{ color: "var(--muted)", gridColumn: "1 / -1" }}>SelectableList</h2>
        <SelectableList
          label="Example menu"
          items={[
            { id: "r", label: "Ranked", desc: "1v1. Winner takes casual Elo.", onActivate: noop },
            { id: "d", label: "Duet", desc: "Sing it together.", onActivate: noop },
            { id: "t", label: "Training", desc: "Just you.", onActivate: noop },
            { id: "l", label: "Leaderboard", secondary: true, onActivate: noop },
          ]}
        />
        <SelectableList
          label="Example grid"
          columns={3}
          items={["Creep", "Cupid", "Perfect", "Viva la Vida", "From the Start"].map((t, i) => ({
            id: t,
            label: t,
            content: (
              <span style={{ display: "grid", gap: "var(--sp-1)" }}>
                <span className="t-num" style={{ color: "var(--ice)" }}>{String(i + 1).padStart(3, "0")}</span>
                <span className="t-song">{t}</span>
              </span>
            ),
            onActivate: noop,
          }))}
        />
      </section>

      <section aria-labelledby="ds-misc" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-6)" }}>
        <h2 id="ds-misc" className="t-label" style={{ color: "var(--muted)", gridColumn: "1 / -1" }}>Panel, Digits, KeyHint, Img</h2>
        <Panel>
          <p className="t-label" style={{ margin: 0, color: "var(--muted)" }}>Your score</p>
          <p className="t-score" style={{ margin: "var(--sp-2) 0 0" }}><Digits value={n} /></p>
          <p className="t-num" style={{ margin: "var(--sp-2) 0 0", color: "var(--ice)" }}><Digits value={`0:${String(n % 60).padStart(2, "0")}`} /></p>
        </Panel>
        <div style={{ display: "grid", gap: "var(--sp-3)", alignContent: "start", color: "var(--muted)" }}>
          <span className="t-label" style={{ display: "flex", gap: "var(--sp-5)" }}>
            <KeyHint keys={["↑", "↓"]} label="Move" />
            <KeyHint keys={["Enter"]} label="Select" />
            <KeyHint keys={["Esc"]} label="Back" />
          </span>
          <span className="t-body">Img with a missing file renders nothing between these brackets: [<Img src={Images.heroHome} />]</span>
        </div>
      </section>
    </main>
  );
}
