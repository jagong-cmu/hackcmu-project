import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bloom } from "../theme/Bloom.tsx";
import { VoiceWave } from "../theme/VoiceWave.tsx";
import { ModeButton } from "./ModeButton.tsx";
import { commitDisplayName, getDisplayName, validName } from "./identity.ts";
import { useRoom } from "../rooms/RoomProvider.tsx";

const MORE = [
  { label: "Play with a friend", to: "/play/ranked" },
  { label: "Training", to: "/training" },
  { label: "Duet", to: "/play/duet" },
  { label: "Chaos", to: "/play/chaos" },
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
    return saved;
  }

  async function play(e?: FormEvent) {
    e?.preventDefault();
    if (!(await saveName())) return;
    navigate("/play/ranked?go=1");
  }

  async function go(to: string) {
    if (named) {
      await saveName();
      navigate(to);
      return;
    }
    navigate(`/settings?next=${to}`);
  }

  return (
    <main className="home-simple bloom-page">
      <Bloom />
      <VoiceWave />

      <nav className="home-nav">
        <Link to="/settings">Settings</Link>
        <Link to="/leaderboard">Board</Link>
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

        <nav className="home-more" aria-label="More ways to sing">
          {MORE.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              onClick={(e) => {
                e.preventDefault();
                void go(item.to);
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </main>
  );
}
