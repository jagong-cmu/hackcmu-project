import { useEffect, useMemo, useState } from "react";
import type { MelodyFile } from "@karaoke/shared";
import { Img } from "../ui/Img.tsx";
import { artFor } from "../ui/assets.ts";
import { SelectableList, type ListItem } from "../ui/SelectableList.tsx";
import type { ReadySong } from "../scoring/catalog.ts";
import { vocalRange } from "./vocalRange.ts";
import "./songGrid.css";

/** Columns follow the CSS breakpoints: 3 at 1200+, 2 at 760+, else 1. */
function useColumns(): number {
  const q = ["(min-width: 1200px)", "(min-width: 760px)"];
  const read = () => (matchMedia(q[0]!).matches ? 3 : matchMedia(q[1]!).matches ? 2 : 1);
  const [cols, setCols] = useState(read);
  useEffect(() => {
    const lists = q.map((s) => matchMedia(s));
    const on = () => setCols(read());
    lists.forEach((m) => m.addEventListener("change", on));
    return () => lists.forEach((m) => m.removeEventListener("change", on));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return cols;
}

/** Vocal range per song, read from melody.json once; songs without note data get none. */
function useRanges(songs: ReadySong[]): Record<string, string> {
  const [ranges, setRanges] = useState<Record<string, string>>({});
  useEffect(() => {
    let off = false;
    for (const s of songs) {
      if (!s.ready) continue;
      fetch(`/songs/${s.id}/melody.json`)
        .then((r) => (r.ok ? (r.json() as Promise<MelodyFile>) : null))
        .then((m) => {
          const range = m && vocalRange(m);
          if (!off && range) setRanges((prev) => ({ ...prev, [s.id]: range }));
        })
        .catch(() => undefined);
    }
    return () => {
      off = true;
    };
  }, [songs]);
  return ranges;
}

export function SongGrid({
  songs,
  selectedId,
  onSelect,
  onStart,
  onBack,
}: {
  songs: ReadySong[];
  selectedId: string;
  onSelect: (id: string) => void;
  onStart: () => void;
  onBack: () => void;
}) {
  const columns = useColumns();
  const ranges = useRanges(songs);

  const items: ListItem[] = useMemo(
    () =>
      songs.map((s, i) => {
        const range = ranges[s.id];
        return {
          id: s.id,
          label: `${s.title} — ${s.artist}`,
          disabled: !s.ready,
          onActivate: onStart,
          content: (
            <span className="song-cell" data-song-id={s.id} title={s.title} aria-label={`${s.title}, ${s.artist}${range ? `, range ${range}` : ""}`}>
              <span className="song-num t-num">{String(i + 1).padStart(3, "0")}</span>
              <span className="song-art" aria-hidden="true">
                <span className="song-art-letter">{s.title.charAt(0)}</span>
                <Img src={artFor(s.id)} alt="" />
              </span>
              <span className="song-text">
                <span className="song-title t-song">{s.title}</span>
                <span className="song-artist">{s.artist}</span>
                {range ? <span className="song-range t-label">{range}</span> : null}
              </span>
            </span>
          ),
        };
      }),
    [songs, ranges, onStart],
  );

  // SelectableList keeps its own index and has no initial-selection prop, so
  // restore the remembered song by focusing its cell once the list exists.
  useEffect(() => {
    if (!songs.length) return;
    document.querySelector<HTMLElement>(`.song-grid [data-song-id="${CSS.escape(selectedId)}"]`)?.closest("button")?.focus({ preventScroll: false });
    // Once per catalog load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songs.length > 0]);

  return (
    <SelectableList
      className="song-grid"
      label="Songs"
      columns={columns}
      items={items}
      onBack={onBack}
      onSelectionChange={(it) => onSelect(it.id)}
    />
  );
}
