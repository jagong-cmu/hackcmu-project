# note_extraction

Offline tool that turns a song's vocal into timed, lyric-tagged target notes for
the karaoke site. It writes the site's own `melody.json` format, plus UltraStar
`.txt`, a sanity report and a debug dump. It has its own Python environment and
never touches the website's dependencies.

```
audio (mix or stem) ─▶ 1 isolate ─▶ 2 pitch ─▶ 3 tuning ─▶ 4 segment ─▶ 5 lyrics ─▶ 6 export
                       Demucs       RMVPE      A440 grid   notes        WhisperX     melody.json
                                    (CREPE,    + octave    (vibrato,    + pyphen     song.txt
                                     pYIN)       repair     glides)                   sanity, debug
```

## Setup

Python 3.12 (3.13+ is not supported by the torch/whisperx stack yet), ffmpeg on PATH.

```sh
cd tools/note_extraction
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest          # 19 tests, no models needed
```

Models download on first use and are cached: RMVPE weights (~180 MB) into
`models/`, Demucs and the WhisperX/wav2vec2 aligner (~360 MB) into the usual
torch / Hugging Face caches. `models/`, `work/`, `out/` and `.venv/` are gitignored.

GPU: `--device auto` picks CUDA, then Apple MPS, then CPU. CPU-only works; on an
M3 Pro a 4-minute song takes ~15 s from a stem and ~50 s from a full mix.

## Commands

`./ne` runs the CLI inside the virtualenv.

```sh
# One song from a full mix (Demucs separates the vocal; the instrumental is saved too)
./ne extract song.mp3 --lyrics lyrics.txt --out out/song-name/

# From an isolated vocal (skips separation; preferred whenever you have one)
./ne extract --stem vocals.wav --lyrics lyrics.lrc --out out/song-name/

# Put it on the site: notes are written on the karaoke track's timeline
./ne extract --stem vocals.wav --lyrics ../../apps/web/public/songs/<id>/lyrics.lrc \
    --site-offset 3.53 --site-dir ../../apps/web/public/songs/<id> \
    --backing ../../apps/web/public/songs/<id>/instrumental.mp3 --out out/<id>/

# Many songs: a manifest (songs.yaml) or a folder with one sub-folder per song
./ne batch songs.yaml --out out/          # skips songs whose outputs exist
./ne batch songs_in/ --out out/ --rerun   # run them anyway (cached stages stay cached)
./ne batch songs.yaml --out out/ --force  # redo every stage

# Compare with reference note files (UltraStar .txt or site melody.json)
./ne evaluate --pred out/song-name/ --ref reference/song-name.txt [--pred ... --ref ...]

# Review and correct one song in the browser
./ne review out/song-name/

# Score stages 2-4 on synthetic singing with known notes (and sweep thresholds)
./ne benchmark [--sweep]
```

Common flags: `--device auto|cpu|cuda|mps`, `--tracker rmvpe|crepe|pyin`,
`--config my.yaml`, `--force`, `-q`. Each stage logs its time; failures say what
is missing (ffmpeg, a GPU you asked for, a model download).

Batch folder layout: `songs_in/<id>/` holding the mix (any audio file),
optionally `vocals.*` (stem), `lyrics.txt` or `lyrics.lrc`, and `song.yaml` with
`title`, `artist`, `site_offset_sec`, `site_dir`, `backing`.

### Caching

Every stage caches its output in `work/<id>/` under a key built from its inputs,
its config section and the previous stage's key. Change a segmentation threshold
and only segmentation, lyrics and export re-run (well under a second). A fully
cached re-run of a song takes ~1 s and writes byte-identical files.

## Timelines (read this before adding a song)

All notes are computed on the **source** timeline: the stem's, or the mix's when
Demucs separates it. The site plays a karaoke **cover** (`instrumental.mp3`), not
the original, so everything written for the site is shifted:

```
site time = source time + site_offset_sec
```

For the existing songs the offsets come from `apps/web/scripts/rebuild-melodies.mjs`:
`offsetSec` maps original to karaoke, `vocalSec` maps original to stem, so with a
stem `site_offset_sec = offsetSec - vocalSec`, and with a mix it is `offsetSec`.
`songs.yaml` has all seven worked out. `apps/web/scripts/measure-offset.mjs`
measures `offsetSec` for a new song.

A stem must be a straight export on the original's timeline. Viva La Vida's and
Cupid's acapellas have sections cut out, so those two are separated from the
original mix instead (`songs.yaml`). Using an edited stem shifts every note
after the first cut.

LRC lyrics are assumed to be timed to the site's track (the site's own
`lyrics.lrc` files are); `--lrc-offset` overrides that.

## Adding a song to the site

1. Put the karaoke track, `lyrics.lrc` and `meta.json` in
   `apps/web/public/songs/<id>/` the way the existing songs are, and add the id to
   `manifest.json`.
2. Measure `offsetSec` (`node apps/web/scripts/measure-offset.mjs original.mp3 karaoke.mp3`)
   and, with a stem, `vocalSec`. Run `check-key.mjs` too: a transposed cover makes
   every note wrong by the same interval.
3. Add an entry to `songs.yaml` and run `./ne batch songs.yaml --out out/ --only <id>`.
4. Read `out/<id>/sanity.md`, then `./ne review out/<id>/` and listen to the
   sections it ranks highest. Fix what's wrong and Save.
5. Re-run with `--site-dir ../../apps/web/public/songs/<id>` (or Save in the
   review tool once `site_dir` is set) to write `melody.json` into the site.

## Outputs (`out/<id>/`)

| file | what |
|---|---|
| `melody.json` | **site format** (`MelodyFile`): `{sampleRateHz: 50, startSec: 0, hz: [Hz or null]}` on the karaoke timeline. Each note is its equal-tempered Hz (2 decimals). Two touching notes of the same pitch get one empty frame between them so the site still sees two onsets. |
| `song.txt` | UltraStar 1.1.0. `#BPM:1200` (beat = 15/1200 s = 12.5 ms), `#GAP` in ms on the karaoke track, pitch relative to C4 = 0, `-` line breaks, `~` held syllables, `#AUDIO` and `#MP3`. |
| `notes.json` | current notes (start/end s on the source timeline, MIDI, syllable, line_break, flags) + metadata. The review tool edits this. |
| `notes.auto.json` | the pipeline's output, never edited, for re-diffing. A re-run never overwrites a reviewed `notes.json` unless `--force`. |
| `sanity.json`, `sanity.md` | flags, per-section review scores, summary. |
| `debug.json` | raw f0, confidence, voiced flags, corrected MIDI curve, tuning, octave fixes, every parameter used, inputs. |
| `vocals.wav`, `instrumental.wav` | the vocal used (mono 16-bit) and, when separated, the backing. |

Note flags: `glide` (part of a slide), `split-syllable` (one note split for
several syllables), `held` (continues the previous syllable, `~`),
`rearticulated` (split at a consonant on a repeated pitch), `edited` (changed in review).

## Config (`config.yaml`)

Every threshold is there with a comment. The ones that matter most:

| key | default | effect |
|---|---|---|
| `pitch.tracker` | rmvpe | RMVPE is trained on singing; CREPE/pYIN are fallbacks. |
| `pitch.fmin_hz`/`fmax_hz` | 65 / 1100 | search range (C2 to C#6). |
| `pitch.voiced_confidence.*` | 0.05 / 0.5 / 0.5 | per tracker; frames below are unvoiced. |
| `pitch.octave_*` | 0.2 s, ±1 st, MAD 1 st | single-frame octave slips snap to agreeing neighbours; real octave leaps survive. |
| `tuning.review_cents` | 40 | larger offsets are flagged (pitch-shifted or non-A440 track). |
| `segmentation.split_st` / `split_hold_sec` | 0.7 st / 60 ms | a note change must move this far and stay. |
| `segmentation.vibrato_sec` | 0.12 | split decisions read the curve averaged over ~one vibrato cycle; vibrato up to ±1 st stays one note. |
| `segmentation.gap_break_sec` | 0.1 | longer unvoiced gaps always end a note. |
| `segmentation.min_note_sec` / `merge_gap_sec` | 80 ms / 80 ms | drop blips; merge same-pitch fragments. |
| `segmentation.onset_dip_db` | 8 | a loudness dip this deep splits a repeated same-pitch note (a consonant). 0 = off. |
| `segmentation.glide_*` | 8 st/s, 0.2 s, 1.5 st | slides at least this fast, long and wide become flagged runs of short notes; shorter scoops stay with their target note. |
| `lyrics.whisper_model` | small | only used when lyrics have no timestamps. |
| `sanity.*` | | plausible range 36-88, octave-jump limit, section length. |

## Review tool

`./ne review out/<id>/` opens a local page (127.0.0.1 only):

- Plays the vocal and the backing (the site's karaoke track, shifted onto the
  vocal's timeline), and optionally the notes as synth tones, each toggleable.
- Scrolling piano roll with syllables, the raw f0 curve faintly behind, flagged
  regions shaded, and a "Review first" list ranked by section score (click to seek).
  Times in the tool are on the vocal's timeline; `sanity.md` uses the karaoke track's.
- Click a note, then: ↑/↓ semitone, `[` `]` move start, `{` `}` move end (±10 ms,
  Alt for 50 ms), `S` split at the playhead, `M` merge with the next, `Del`, `Z` undo.
- Global offset slider (±1 s) to slide all notes against the audio; it is baked in on Save.
- "Diff vs auto" outlines the untouched pipeline output.
- Save writes `notes.json`, `melody.json`, `song.txt` (and the site copy if `site_dir` is set).

## Evaluation

`./ne evaluate` converts both sides to a 10 ms grid, finds the global time offset
by cross-correlating the voiced masks (reference files often carry a different
GAP) and applies it, then reports with `mir_eval`: raw pitch / raw chroma /
overall accuracy, voicing recall and false alarm, note onset F (±50 ms) and note
F (onset ±50 ms, pitch ±50 cents), plus the ten worst 2-second regions and
whether they are missed voicing, false alarms, octave errors or wrong pitch.

**There are no known-good reference note files for these songs.** Everything
below is either synthetic ground truth or agreement between two automatic
outputs. Neither says how right the notes are against what was actually sung.
Two to five hand-checked UltraStar files would turn `./ne evaluate` into a real
measurement; the threshold sweep (`./ne benchmark --sweep`) could then run
against them too.

### Synthetic ground truth (`./ne benchmark`)

Four rendered voices (bass, tenor, alto, soprano; ~300 known notes; vibrato
±0.5-0.9 st, scoops, 80-300 ms slides, consonant gaps, breath noise) through the
real RMVPE, octave repair, tuning and segmentation. Tuning used one threshold at
a time and a change was kept only if it improved every voice.

| | note F mean | worst voice | onset F | raw pitch |
|---|---|---|---|---|
| thresholds as first written | 0.676 | 0.599 (soprano) | 0.746 | 0.951 |
| + `onset_dip_db: 8` (repeated-note split) | 0.738 | 0.662 | 0.806 | 0.951 |
| + `glide_min_sec: 0.12 -> 0.2` | **0.761** | **0.689** | **0.805** | 0.952 |

The sweep moved every other segmentation threshold (`split_st`, `split_hold_sec`,
`vibrato_sec`, `median_sec`, `gap_break_sec`, `min_note_sec`, `merge_gap_sec`,
`glide_rate`) by under ±0.01 note F, so they were left alone. The repeated-note
split was the one structural gain: before it, 0 of 69 re-sung same-pitch notes
were found. The glide change is partly the benchmark's own convention (a slide
counts as part of the note it lands on), so it was not pushed past 0.2 s.

### Agreement checks on the real songs

| check | result |
|---|---|
| new notes vs the site's old `melody.json` (7 songs) | global offset −0.02 to −0.06 s on every song (the timeline mapping is right; the old extractor stamped frames at the start of a 128 ms window, so it runs ~40 ms early). Pitch agreement where both are voiced: raw pitch 0.67-0.79, mean 0.73. |
| Creep: Demucs-separated mix vs the studio acapella | offset −0.06 s, raw pitch 0.76, voicing recall 0.87, false alarm 0.08. |
| Creep: lyric line starts (hand-tapped LRC) vs note onsets | 34 of 37 lines start within 150 ms of a note onset, median +40 ms. |
| tuning offsets, all 7 songs | −3 to +10 cents. None flagged. |

## Known failure modes

- **Backing vocals and harmonies.** Demucs keeps them in the vocal stem, and so
  do most "acapella" uploads. The tracker follows whichever voice is louder;
  `bleed_share` in the sanity summary estimates how often a second pitch competes.
  Viva La Vida and Beauty And A Beat have by far the most voicing outside the
  lyric lines (probably chants, ad-libs and the featured verse; not checked by ear).
- **Lyrics that do not match what is sung.** Rap verses or ad-libs missing from
  `lyrics.lrc` leave many notes without syllables (Beauty And A Beat: 370 of 666).
  Alignment also trusts the LRC line times; a line that is far off misplaces its words.
- **Many-to-one syllables.** When the aligner squeezes several syllables into one
  long note, the note is split proportionally and flagged `split-syllable`: the
  pitch is right, the cut points are guesses.
- **Short consonant gaps are bridged.** RMVPE's 64 ms window spans gaps under
  ~80 ms, so they read as voiced; the loudness-dip split recovers repeated notes,
  but soft consonants (l, m, n) under 8 dB still merge.
- **Fast runs and melismas.** Notes under ~120 ms between other notes can blur
  into neighbours (the vibrato-averaging window). Slides over 0.2 s become runs of
  short `glide` notes, which are correct as pitch but busy as a karaoke target.
- **Breath, fall-offs and fry.** Short low notes at phrase ends (a fall-off after
  a held note) come out as real notes without lyrics. They are flagged
  `note_without_syllable`; delete them in review if they shouldn't be scored.
- **Edited stems** (sections cut out) put every later note at the wrong time.
  Use the mix instead, as `songs.yaml` does for Viva La Vida and Cupid.
- **Transposed karaoke covers** make every note wrong by the same interval. The
  pipeline cannot see this; `check-key.mjs` can.
- **Duets.** LRC `A:`/`B:` prefixes are dropped; output is one part. UltraStar
  `P1`/`P2` is not written.

## What needs a human ear

Nothing here has been checked by listening. Before shipping a song: open it in
the review tool with Synth on, listen to the top five "Review first" sections and
to every `big_jump` and `out_of_range` flag, and check that the first notes of
each verse line up with the backing track (the global offset slider fixes a
constant drift).

## Layout

```
note_extraction/   separate.py pitch.py _rmvpe.py tuning.py segment.py lyrics.py export.py
                   sanity.py pipeline.py evaluate.py benchmark.py review_server.py cli.py
review/index.html  the review page
tests/             segmentation, octave repair, tuning, formats, syllables, review server
config.yaml        every threshold
songs.yaml         the site's seven songs
examples/creep/    one processed song: melody.json, song.txt, notes.json, sanity.md
```

`_rmvpe.py` vendors the RMVPE network from the RVC project (MIT; notice in the file).
