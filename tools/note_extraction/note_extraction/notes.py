"""The note model every stage after segmentation passes around, and notes.json I/O."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass
class Note:
    start: float  # seconds, source (vocal) timeline
    end: float
    midi: int
    syllable: str | None = None
    # True when a lyric line ends before this note (UltraStar "-" goes before it).
    line_break: bool = False
    # "glide", "split-syllable", "held", "edited", ...
    flags: list[str] = field(default_factory=list)

    @property
    def dur(self) -> float:
        return self.end - self.start


def hz_from_midi(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def save_notes(path: Path, notes: list[Note], meta: dict) -> None:
    """notes.json: meta fields (site_offset_sec, tuning_cents, ...) plus the note list."""
    body = {**meta, "notes": [asdict(n) for n in notes]}
    Path(path).write_text(json.dumps(body, indent=1, ensure_ascii=False))


def load_notes(path: Path) -> tuple[list[Note], dict]:
    body = json.loads(Path(path).read_text())
    notes = [Note(**n) for n in body.pop("notes")]
    return notes, body
