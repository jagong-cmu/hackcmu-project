import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { capture } from "../analytics/posthog.ts";
import { useAuth } from "../auth/AuthProvider.tsx";
import { LegalLinks } from "../legal/LegalLinks.tsx";
import { useRoom } from "../rooms/RoomProvider.tsx";
import { useScene } from "../scene/SceneProvider.tsx";
import type { RoomId } from "../scene/rooms.ts";
import { KeyHints } from "../ui/KeyHints.tsx";
import { MenuList, type MenuItem } from "../ui/MenuList.tsx";
import { isRoomCode, normalizeRoomCode } from "../ui/roomCode.ts";
import { getDisplayName, validName } from "./identity.ts";

/** Each mode drops you straight into its own queue (or solo Training), in its own room. */
const MODES: { mode: string; label: string; desc: string; room: RoomId; to: string }[] = [
  { mode: "ranked", label: "Ranked", desc: "1v1. The same chorus, you then them. Winner takes casual Elo.", room: "ranked", to: "/play/ranked?go=1" },
  { mode: "duet", label: "Duet", desc: "Sing the whole song together. One shared score, no Elo.", room: "duet", to: "/play/duet?go=1" },
  { mode: "training", label: "Training", desc: "Just you. Live pitch, scored, no Elo.", room: "training", to: "/training" },
  { mode: "chaos", label: "Chaos", desc: "Drop into the party. Up to eight on camera, no score.", room: "party", to: "/play/chaos?go=1" },
];

/**
 * The main menu: a left-aligned list of modes over the room. The backdrop
 * crossfades to each mode's room as it is selected. Replaces the old Home and
 * mode-picker pages; the analytics events they fired still fire.
 */
export function MainMenu() {
  const navigate = useNavigate();
  const { mode: authMode, user } = useAuth();
  const { setMenuRoom } = useScene();
  const { hello, roomJoin, connected, error } = useRoom();
  const signedOut = authMode === "accounts" && !user;
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState("");
  const named = validName(getDisplayName());

  function play(m: (typeof MODES)[number]) {
    if (signedOut) {
      capture("play pressed", { signedIn: false });
      navigate(`/signin?next=${encodeURIComponent(m.to)}`);
      return;
    }
    capture("play pressed", {});
    capture("mode selected", { mode: m.mode, via: "menu" });
    navigate(named ? m.to : `/settings?next=${encodeURIComponent(m.to)}`);
  }

  function join() {
    if (!isRoomCode(code)) return;
    if (signedOut) return navigate(`/signin?next=${encodeURIComponent("/")}`);
    if (!named) return navigate(`/settings?next=${encodeURIComponent("/")}`);
    hello(getDisplayName());
    roomJoin(code); // the room provider takes us to /room/:code once it joins
  }

  const items: MenuItem[] = [
    ...MODES.map((m) => ({ id: m.mode, label: m.label, desc: m.desc, onActivate: () => play(m) })),
    {
      id: "code",
      label: "Room code",
      desc: "Join a friend's room, or try the demo room: 0000.",
      onActivate: () => setCodeOpen(true),
      content: codeOpen ? (
        <span className="menu-field">
          Room code
          <input
            autoFocus
            inputMode="numeric"
            maxLength={4}
            aria-label="Room code, four digits"
            value={code}
            onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                join();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setCodeOpen(false);
                setCode("");
              }
            }}
          />
        </span>
      ) : undefined,
    },
    { id: "board", label: "Leaderboard", secondary: true, desc: "Who has been singing.", onActivate: () => navigate("/leaderboard") },
    { id: "settings", label: "Settings", secondary: true, desc: "Your name, mic and camera.", onActivate: () => navigate("/settings") },
  ];

  const roomOf = (id: string): RoomId | null => MODES.find((m) => m.mode === id)?.room ?? null;

  return (
    <main className="main-menu">
      <header className="menu-top">
        <h1 className="menu-brand">Aria</h1>
        <Link to="/stats">Stats</Link>
      </header>

      <div>
        <MenuList
          items={items}
          label="Main menu"
          onSelectionChange={(it) => {
            const room = roomOf(it.id);
            if (room) setMenuRoom(room);
          }}
          onBack={() => {
            setCodeOpen(false);
            setCode("");
          }}
        />
        {codeOpen && code.length === 4 ? (
          <p className="menu-error" role="status">
            {connected ? "Press Enter to join." : "Connecting…"}
          </p>
        ) : null}
        {error ? (
          <p className="menu-error" role="alert">
            {error.message}
          </p>
        ) : null}
        {signedOut ? <p className="menu-error">Sign in with Google to sing.</p> : null}
        {authMode === "unconfigured" ? <p className="menu-error">Accounts aren&rsquo;t configured.</p> : null}
      </div>

      <footer className="menu-foot">
        <LegalLinks />
      </footer>
      <KeyHints />
    </main>
  );
}
