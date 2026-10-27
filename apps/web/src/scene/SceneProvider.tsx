import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { sceneFor, type RoomId, type Scene } from "./rooms.ts";

/** Menu selections must rest this long before the backdrop starts to crossfade. */
export const MenuRestMs = 150;

type SceneApi = {
  scene: Scene;
  /** The main menu's selection (debounced); null clears it. */
  setMenuRoom: (room: RoomId | null) => void;
  /** The live room's own mode, so room 0000 and private codes show their mode's room. */
  setRoomMode: (mode: string | null) => void;
  setLeaderboardTab: (tab: "ranked" | "duet") => void;
};

const Ctx = createContext<SceneApi | null>(null);

export function SceneProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [menuRoom, setMenuRoomNow] = useState<RoomId | null>(null);
  const [roomMode, setRoomMode] = useState<string | null>(null);
  const [leaderboardTab, setLeaderboardTab] = useState<"ranked" | "duet">("ranked");
  const timer = useRef<number | undefined>(undefined);

  const setMenuRoom = useCallback((room: RoomId | null) => {
    window.clearTimeout(timer.current);
    if (room == null) return setMenuRoomNow(null);
    timer.current = window.setTimeout(() => setMenuRoomNow(room), MenuRestMs);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // The menu selection and the live room's mode only mean something on their own screens.
  useEffect(() => {
    if (!pathname.startsWith("/room/")) setRoomMode(null);
    if (pathname !== "/" && pathname !== "/play") setMenuRoomNow(null);
  }, [pathname]);

  const scene = useMemo(
    () => sceneFor(pathname, { menuRoom, roomMode, leaderboardTab }),
    [pathname, menuRoom, roomMode, leaderboardTab],
  );
  const api = useMemo(
    () => ({ scene, setMenuRoom, setRoomMode, setLeaderboardTab }),
    [scene, setMenuRoom],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useScene(): SceneApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useScene needs a SceneProvider");
  return api;
}
