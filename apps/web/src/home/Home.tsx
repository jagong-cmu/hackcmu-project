import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bloom } from "../theme/Bloom.tsx";
import { VoiceWave } from "../theme/VoiceWave.tsx";
import { ModeButton } from "./ModeButton.tsx";
import { commitDisplayName, getDisplayName, validName } from "./identity.ts";
import { useRoom } from "../rooms/RoomProvider.tsx";
import { capture, identifyPlayer } from "../analytics/posthog.ts";

const MORE = [
  { label: "Play with a friend", hint: "create or join a room", to: "/play/ranked" },
  { label: "Training", hint: "solo, scored", to: "/training" },
  { label: "Duet", hint: "create or join a room", to: "/play/duet" },
  { label: "Chaos", hint: "create or join a lounge", to: "/play/chaos" },
];

export function Home() {
  const navigate = useNavigate();
  const { hello } = useRoom();
  const [name, setName] = useState(getDisplayName());
  const [msg, setMsg] = useState("");
  const named = validName(name);

  async function saveName(): Promise<string | null> {
    if (!validName(name)) {
      setMsg("Name needs 2–16 characters.");
      return null;
    }
    const saved = await commitDisplayName(name);
    hello(saved);
    identifyPlayer();
    return saved;
  }

  async function play(e?: FormEvent) {
    e?.preventDefault();
    if (!(await saveName())) return;
    capture("mode selected", { mode: "ranked", via: "play" });
    navigate("/play/ranked?go=1");
  }

  async function go(to: string) {
    const mode =
      to.includes("training") ? "training" : to.includes("duet") ? "duet" : to.includes("chaos") ? "chaos" : "ranked";
    if (named) {
      await saveName();
      capture("mode selected", { mode, via: "home" });
      navigate(to);
      return;
    }
    capture("mode selected", { mode, via: "home" });
    navigate(`/settings?next=${to}`);
  }

  return (
    <main className="home-simple bloom-page">
      <Bloom />
      <VoiceWave />

      <nav className="home-nav">
        <Link to="/settings">Settings</Link>
        <Link to="/leaderboard">Board</Link>
        <Link to="/stats">Stats</Link>
      </nav>

      <div className="home-hero">
        <h1 className="wordmark">Aria</h1>
        <div className="hero-rule" aria-hidden="true">
          <span className="hero-rule-line" />
          <span className="hero-rule-dot" />
          <span className="hero-rule-line" />
        </div>
        <p className="home-pitch">1v1 karaoke. Same chorus. They watch you.</p>

        <form className="home-go" onSubmit={(e) => void play(e)}>
          <label className="home-name">
            <span>Your name</span>
            <input
              value={name}
              maxLength={16}
              autoComplete="nickname"
              autoFocus={!named}
              placeholder="2–16 characters"
              aria-invalid={msg ? true : undefined}
              onChange={(e) => {
                setName(e.target.value);
                if (msg) setMsg("");
              }}
            />
          </label>
          {msg ? <p className="err home-name-err">{msg}</p> : null}

          <div className="modes home-play">
            <ModeButton label="Play" hint="ranked 1v1" onSelect={() => void play()} />
          </div>
        </form>

        <nav className="home-modes" aria-label="More ways to sing">
          {MORE.map((item) => (
            <Link
              key={item.label}
              className="home-mode"
              to={item.to}
              onClick={(e) => {
                e.preventDefault();
                void go(item.to);
              }}
            >
              <span className="home-mode-label">{item.label}</span>
              <span className="home-mode-hint">{item.hint}</span>
            </Link>
          ))}
        </nav>
      </div>
    </main>
  );
}
