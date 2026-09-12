/**
 * LANE A — temporary landing page.
 *
 * This exists so Lane A can exercise rooms, queues and the clock without
 * waiting on Lane B. It is NOT the product Home.
 *
 * LANE B: build the real Home in `apps/web/src/home/`, then change the one
 * `/` route in App.tsx to point at it and delete this file. The actions below
 * are exactly the hooks you need — `useRoom()` gives you queueJoin, roomCreate,
 * roomJoin and chaosJoin.
 */
import { useEffect, useRef, useState } from "react";
import { DemoRoomCode } from "@karaoke/shared";
import { useRoom } from "./RoomProvider.tsx";
import { getDisplayName } from "./socket.ts";

export default function DevLanding() {
  const { connected, me, error, hello, queueJoin, roomCreate, roomJoin, chaosJoin } = useRoom();
  const [name, setName] = useState(getDisplayName());
  const [code, setCode] = useState("");

  // Re-announce once the socket is up so the server has our chosen name.
  // Read the name through a ref so typing does not re-emit on every keystroke.
  const nameRef = useRef(name);
  nameRef.current = name;
  useEffect(() => {
    if (connected && nameRef.current.trim()) hello(nameRef.current);
  }, [connected, hello]);

  return (
    <div className="landing">
      <h1>Karaoke Arena</h1>
      <p className="note">
        Lane A dev landing. Real Home is Lane B's (<code>apps/web/src/home/</code>).
        Point the <code>/</code> route at it when it lands.
      </p>

      <div className="row">
        <input
          value={name}
          placeholder="display name"
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
        />
        <button onClick={() => hello(name)} disabled={!connected}>
          Save name
        </button>
        <span className="slot-empty">
          {connected ? `connected as ${me?.displayName ?? "…"}` : "offline"}
        </span>
      </div>

      {error && <p className="err">{error.code}: {error.message}</p>}

      <div className="row">
        <strong style={{ width: "5rem" }}>Ranked</strong>
        <button onClick={() => queueJoin("ranked")}>Random</button>
        <button onClick={() => roomCreate("ranked")}>Create room</button>
        <button className="primary" onClick={() => roomJoin(DemoRoomCode)}>
          Join {DemoRoomCode}
        </button>
      </div>

      <div className="row">
        <strong style={{ width: "5rem" }}>Duet</strong>
        <button onClick={() => queueJoin("duet")}>Random</button>
        <button onClick={() => roomCreate("duet")}>Create room</button>
      </div>

      <div className="row">
        <strong style={{ width: "5rem" }}>Chaos</strong>
        <button onClick={() => chaosJoin()}>Join queue</button>
        <button onClick={() => roomCreate("chaos")}>Create private</button>
      </div>

      <div className="row">
        <input
          value={code}
          placeholder="4-digit code"
          maxLength={4}
          inputMode="numeric"
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        />
        <button onClick={() => roomJoin(code)} disabled={code.length !== 4}>
          Enter code
        </button>
        <button onClick={() => chaosJoin(code)} disabled={code.length !== 4}>
          Chaos code
        </button>
      </div>
    </div>
  );
}
