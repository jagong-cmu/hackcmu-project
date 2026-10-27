import { useState } from "react";
import "./songPicker.css";

export type PickerSong = { id: string; title: string; artist: string; ready: boolean };

/**
 * Each song has a display number (001, 002, ...), noraebang-songbook style. Cover art is optional: /songs/<id>/cover.jpg when it exists, otherwise a
 * token-coloured tile with the title's first letter. The UI is complete
 * without any image.
 */
function Cover({ id, title }: { id: string; title: string }) {
  const [missing, setMissing] = useState(false);
  return (
    <span className="song-cover" aria-hidden="true">
      {missing ? null : (
        <img src={`/songs/${id}/cover.jpg`} alt="" loading="lazy" onError={() => setMissing(true)} />
      )}
      <span className="song-cover-fallback">{title.trim().charAt(0).toUpperCase()}</span>
    </span>
  );
}

/** A songbook page: cover, title, artist. A native radio group, so arrow keys just work. */
export function SongPicker({
  songs,
  value,
  onChange,
  disabled,
}: {
  songs: PickerSong[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="song-picker" disabled={disabled}>
      <legend>Song</legend>
      {songs.map((s, i) => (
        <label key={s.id} className={`song-entry${s.id === value ? " is-picked" : ""}${s.ready ? "" : " is-off"}`}>
          <input
            type="radio"
            name="song"
            value={s.id}
            checked={s.id === value}
            disabled={!s.ready}
            onChange={() => onChange(s.id)}
          />
          <span className="song-no">{String(i + 1).padStart(3, "0")}</span>
          <Cover id={s.id} title={s.title} />
          <span className="song-entry-text">
            <span className="song-entry-title">{s.title}</span>
            <span className="song-entry-artist">{s.ready ? s.artist : `${s.artist} · incomplete`}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
