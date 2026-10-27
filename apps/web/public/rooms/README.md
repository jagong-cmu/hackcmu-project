# Room images

Four rooms, one per mode. The owner generates these (Nano Banana); the app builds
the slots, fallbacks, loading and switching. **Without these files the app still
works**: every page falls back to the solid maroon-black `--ink` colour.

| Room | File stem | Used for |
|---|---|---|
| Ranked | `ranked` | Ranked 1v1, private Ranked rooms, Ranked leaderboard, and the default room (menu before a selection, sign-in, settings, errors, darkened) |
| Duet | `duet` | Duet, Duet leaderboard |
| Training | `training` | Training |
| Party | `party` | Chaos |

For each room add, next to this file:

- `<stem>.avif` and `<stem>.webp`: 2560 px wide, **at most 400 KB each**. AVIF is preferred; WebP is the fallback.
- `<stem>-blur.webp`: a tiny (about 32 px wide) blurred copy, under 2 KB. It shows instantly while the full image loads.

Brief (from SPEC2): all four from one shared style prompt, same camera height, lens and time of night. Red/maroon padded walls,
tufted vinyl seating, a low table with a microphone and remote, a framed glowing TV, warm low light. No text, logos, brand names or people.
Composition: the left third darker and quiet (the menu sits there), the centre fairly plain (feeds and lyrics cover it
during play), interest at the edges and centre-right.

**Menu readability is a hard requirement:** the left 45% of every image must be no brighter than 0.12 relative
luminance (99th percentile). Run the dev server and open `/scene-check` to measure the files you add.

The TV's position, for the live glow, is `TvGlow` in `src/scene/rooms.ts` (percent of the viewport); adjust it per room once the images exist.
