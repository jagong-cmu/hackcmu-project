/**
 * Dev-only reference page (`/system`): every token and core component in one
 * place, for visual review. Not routed in production builds.
 */
const SWATCHES = [
  "ink", "surface", "surface-2", "surface-3",
  "red-800", "red-600", "red-400", "red-300",
  "gold-800", "gold-600", "gold-300", "gold-200", "gold-100",
  "spot-1", "spot-2", "spot-3", "spot-4", "spot-5",
  "danger",
];

const SCALE: [string, string][] = [
  ["--text-display", "Aria"],
  ["--text-menu", "Ranked"],
  ["--text-3xl", "Tonight's booth"],
  ["--text-2xl", "Pick your chorus"],
  ["--text-xl", "Room 0000"],
  ["--text-lg", "Ranked 1v1"],
  ["--text-md", "Both singers sing the same fifteen seconds."],
  ["--text-base", "Body copy sits at one rem, in Figtree, at a comfortable measure."],
  ["--text-sm", "Secondary text and labels"],
  ["--text-xs", "Smallest allowed"],
];

export function DesignSystem() {
  return (
    <main style={{ padding: "var(--sp-7)", display: "grid", gap: "var(--sp-7)", maxWidth: "72rem", margin: "0 auto" }}>
      <h1 className="display" style={{ fontSize: "var(--text-3xl)", margin: 0 }}>Design system</h1>

      <section aria-labelledby="ds-color">
        <h2 id="ds-color" className="display" style={{ fontSize: "var(--text-xl)" }}>Colour</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: "var(--sp-3)" }}>
          {SWATCHES.map((n) => (
            <div key={n}>
              <div style={{ height: "3.5rem", background: `var(--${n})`, border: "1px solid var(--edge)", borderRadius: "var(--r-md)" }} />
              <div className="text-meta">{n}</div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="ds-type">
        <h2 id="ds-type" className="display" style={{ fontSize: "var(--text-xl)" }}>Type</h2>
        <div style={{ display: "grid", gap: "var(--sp-3)" }}>
          {SCALE.map(([t, copy]) => (
            <div key={t} style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-5)" }}>
              <code className="text-meta" style={{ width: "9rem", flex: "none" }}>{t}</code>
              <span
                className={t.includes("base") || t.includes("sm") || t.includes("xs") || t.includes("md") ? undefined : "display"}
                style={{ fontSize: `var(${t})` }}
              >
                {copy}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="ds-btn">
        <h2 id="ds-btn" className="display" style={{ fontSize: "var(--text-xl)" }}>Buttons and fields</h2>
        <div style={{ display: "flex", gap: "var(--sp-4)", flexWrap: "wrap", alignItems: "end" }}>
          <button className="btn btn-primary btn-lg">Find a match</button>
          <button className="btn">Enter a code</button>
          <button className="btn btn-ghost">Cancel</button>
          <button className="btn btn-danger">Leave match</button>
          <button className="btn" disabled>Disabled</button>
          <div className="field">
            <label htmlFor="ds-name">Display name</label>
            <input id="ds-name" placeholder="2 to 16 characters" />
            <p className="field-hint">Other singers see this.</p>
          </div>
          <div className="field invalid">
            <label htmlFor="ds-code">Room code</label>
            <input id="ds-code" defaultValue="12" aria-invalid="true" />
            <p className="field-error">Codes are exactly 4 digits.</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="ds-panel">
        <h2 id="ds-panel" className="display" style={{ fontSize: "var(--text-xl)" }}>Panel</h2>
        <div className="panel" style={{ maxWidth: "28rem" }}>
          <h3 className="display" style={{ fontSize: "var(--text-lg)" }}>Private room</h3>
          <p className="text-meta">Unrated. Share the code with a friend.</p>
        </div>
      </section>

      <section aria-labelledby="ds-feed">
        <h2 id="ds-feed" className="display" style={{ fontSize: "var(--text-xl)" }}>Camera feeds</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--sp-5)" }}>
          <figure className="feed" data-state="live" data-side="a" data-you>
            <figcaption className="feed-label">Rae</figcaption>
          </figure>
          <figure className="feed" data-state="live" data-side="b">
            <figcaption className="feed-label">Jonah</figcaption>
          </figure>
          <figure className="feed" data-state="off" data-side="b">
            <div className="feed-state"><strong>Waiting for Jonah</strong>Reconnecting to the room</div>
          </figure>
        </div>
      </section>

      <section aria-labelledby="ds-chaos">
        <h2 id="ds-chaos" className="display" style={{ fontSize: "var(--text-xl)" }}>Chaos, 8 feeds</h2>
        <div className="stage stage-fit" style={{ minHeight: 0, padding: 0, display: "block" }}>
          <div className="grid compact has-featured">
            {["Rae", "Jonah", "Mika", "Dev", "Sol", "Ines", "Tobi", "Wren"].map((n, i) => (
              <div key={n} className={i === 0 ? "chaos-featured" : undefined}>
                <div className="tile feed" data-state="live" data-side={i === 0 ? "b" : "a"} {...(i === 0 ? { "data-you": "" } : {})}>
                  <div className="feed-label">{n}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="ds-score">
        <h2 id="ds-score" className="display" style={{ fontSize: "var(--text-xl)" }}>Score</h2>
        <div style={{ display: "flex", gap: "var(--sp-8)", alignItems: "baseline" }}>
          <div className="score-display is-winner"><span className="num">87</span><span className="score-unit">/100</span></div>
          <div className="score-display"><span className="num">64</span><span className="score-unit">/100</span></div>
          <div className="score-display is-pending"><span className="num">--</span></div>
          <div style={{ display: "grid", gap: "var(--sp-2)" }}>
            <span className="delta is-up">+18 Elo</span>
            <span className="delta is-down">-12 Elo</span>
            <span className="delta is-flat">±0 Elo</span>
          </div>
        </div>
      </section>
    </main>
  );
}
