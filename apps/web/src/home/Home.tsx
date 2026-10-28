import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { capture } from "../analytics/posthog.ts";
import { useAuth } from "../auth/AuthProvider.tsx";
import { LegalLinks } from "../legal/LegalLinks.tsx";
import { Images } from "../ui/assets.ts";
import { Img } from "../ui/Img.tsx";
import { KeyHintBar } from "../ui/KeyHints.tsx";
import { SelectableList, type ListItem } from "../ui/SelectableList.tsx";
import { getDisplayName, validName } from "./identity.ts";
import "./homeMenu.css";

type Entry = {
  id: string;
  label: string;
  /** Existing copy from the queue and room pages. */
  desc: string;
  to: string;
  /** Needs a display name first (the old mode picker's rule). */
  needsName?: boolean;
  secondary?: boolean;
};

const ENTRIES: Entry[] = [
  { id: "ranked", label: "Ranked", desc: "Same 20-second chorus. You then them. Winner takes casual ELO.", to: "/play/ranked?go=1", needsName: true },
  { id: "duet", label: "Duet", desc: "Sing the whole song together. One shared score. No ELO.", to: "/play/duet?go=1", needsName: true },
  { id: "training", label: "Training", desc: "Solo · live pitch · scored", to: "/training", needsName: true },
  { id: "chaos", label: "Chaos", desc: "Walk into a lounge. Cameras and lyrics. No score.", to: "/play/chaos?go=1", needsName: true },
  { id: "room", label: "Room code", desc: "Pick a mode, then send the 4-digit code to a friend.", to: "/play/ranked", needsName: true },
  { id: "leaderboard", label: "Leaderboard", desc: "Who’s been singing.", to: "/leaderboard", secondary: true },
  { id: "settings", label: "Settings", desc: "This is how other singers will see you.", to: "/settings", secondary: true },
];

const KEY = "aria.homeMode";
const stored = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const remember = (id: string) => {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* private mode: just don't remember */
  }
};

/** The stagger plays once per page load, not every time you come back to Home. */
let introPlayed = false;

/**
 * Landing page: a keyboard-first mode menu. Choosing a mode goes where the old
 * mode picker sent it (name check, then that mode's queue); signed-out players
 * go through sign-in first and come back to the same destination.
 */
export function Home() {
  const navigate = useNavigate();
  const { mode, user } = useAuth();
  const signedOut = mode === "accounts" && !user;
  const [intro] = useState(() => !introPlayed);
  const startId = useMemo(() => {
    const s = stored();
    return ENTRIES.some((e) => e.id === s) ? s! : ENTRIES[0]!.id;
  }, []);
  const [selected, setSelected] = useState<string>(startId);
  const root = useRef<HTMLElement>(null);
  const ready = useRef(false);

  useEffect(() => {
    introPlayed = true;
    // SelectableList always starts on its first item; focusing the remembered
    // one moves the selection there (see docs/followups-A.md).
    const i = ENTRIES.findIndex((e) => e.id === startId);
    root.current?.querySelectorAll<HTMLButtonElement>(".sl-item")[i]?.focus({ preventScroll: true });
    ready.current = true;
  }, [startId]);

  function go(e: Entry) {
    capture("mode selected", { mode: e.id, via: "home" });
    if (signedOut) navigate(`/signin?next=${encodeURIComponent(e.to)}`);
    else if (e.needsName && !validName(getDisplayName())) navigate(`/settings?next=${encodeURIComponent(e.to)}`);
    else navigate(e.to);
  }

  const items: ListItem[] = ENTRIES.map((e) => ({
    id: e.id,
    label: e.label,
    secondary: e.secondary,
    onActivate: () => go(e),
  }));
  const current = ENTRIES.find((e) => e.id === selected) ?? ENTRIES[0]!;

  return (
    <main ref={root} className={`home-menu${intro ? " is-intro" : ""}`}>
      <Img className="home-hero" src={Images.heroHome} alt="" />
      <Link to="/stats" className="home-stats">
        Stats
      </Link>

      <div className="home-col">
        <h1 className="t-logo home-logo">Aria</h1>
        <SelectableList
          className="home-list"
          label="Main menu"
          items={items}
          onSelectionChange={(it) => {
            setSelected(it.id);
            if (ready.current) remember(it.id);
          }}
        />
        <div className="home-desc">
          <p key={current.id} className="t-desc home-desc-text" aria-live="polite">
            {current.desc}
          </p>
          <div className="home-illus" aria-hidden="true">
            {ENTRIES.filter((e) => e.id in Images.mode).map((e) => (
              <Img key={e.id} src={Images.mode[e.id as keyof typeof Images.mode]} alt="" data-on={e.id === current.id} />
            ))}
          </div>
        </div>
      </div>

      <footer className="home-foot">
        <LegalLinks />
      </footer>
      <KeyHintBar />
    </main>
  );
}
