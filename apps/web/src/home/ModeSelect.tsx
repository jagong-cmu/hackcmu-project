import { Link, useNavigate } from "react-router-dom";
import { getDisplayName, validName } from "./identity.ts";
import { PageShell } from "../theme/PageShell.tsx";
import { capture } from "../analytics/posthog.ts";

/** Each card drops you straight into that mode's own queue (or solo Training). */
const MODES = [
  { mode: "ranked", label: "Ranked", hint: "1v1 · same chorus · winner takes ELO", to: "/play/ranked?go=1" },
  { mode: "duet", label: "Duet", hint: "sing together · one shared score", to: "/play/duet?go=1" },
  { mode: "chaos", label: "Chaos", hint: "drop into a lounge · no score", to: "/play/chaos?go=1" },
  { mode: "training", label: "Training", hint: "solo · live pitch · scored", to: "/training" },
];

export function ModeSelect() {
  const navigate = useNavigate();
  const named = validName(getDisplayName());

  function go(mode: string, to: string) {
    capture("mode selected", { mode, via: "picker" });
    navigate(named ? to : `/settings?next=${encodeURIComponent(to)}`);
  }

  return (
    <PageShell title="Pick a mode" tag="Choose how you want to sing. We’ll find you a match." wide className="mode-select-page">
      {!named ? (
        <p>
          <Link to="/settings?next=%2Fplay">Set your name</Link> first.
        </p>
      ) : null}

      <nav className="mode-grid" aria-label="Modes">
        {MODES.map((m) => (
          <Link
            key={m.mode}
            className="mode-card"
            to={m.to}
            onClick={(e) => {
              e.preventDefault();
              go(m.mode, m.to);
            }}
          >
            <span className="mode-card-label">{m.label}</span>
            <span className="mode-card-hint">{m.hint}</span>
          </Link>
        ))}
      </nav>

      <p className="mode-private">
        Playing with a friend?{" "}
        <Link
          to="/play/ranked"
          onClick={(e) => {
            e.preventDefault();
            go("private", "/play/ranked");
          }}
        >
          Make a private room
        </Link>
      </p>
    </PageShell>
  );
}
