# Followups from Session B (training / song grid)

For QA. Nothing here blocks Session B; each item is worked around locally.

## `ui/SelectableList.tsx`
- **Add an `initialId` (or `selectedId`) prop.** The list keeps its own `index` and always starts at the first enabled item. Training restores the last song by focusing its cell after mount (`SongGrid.tsx`), which works but is a workaround.
- **Stretch items in a 1-column list too.** `.sl-grid .sl-item { width: 100% }` only applies when `columns > 1`, so a 1-column list with custom `content` gets `fit-content` rows. `songGrid.css` sets `width: 100%` itself.
- The red triangle is sized from the item's font (`0.42em`), so with 15px text it is 6px. Training overrides it to 10x12px. A `--mark-size` token would be cleaner.

## Legacy rules to delete once Training no longer needs them (`index.css`, `theme/theme.css`)
- `.song-pick` (index.css:299, theme.css:903-914): the old `<select>`, no longer rendered.
- The `.training` block in theme.css (~1083-1148). Training's layout now lives in `training/training.css`, which overrides it with `main.page.shell.training`. Delete the block once C's components no longer depend on `.training .lyrics`, `.pitch-guide` and `.stage-self` sizing there.

## `theme/PageShell.tsx` (A)
- Training sets the page-head to `position: static` from its own CSS. If A changes the head markup, check `/training`.

## Not done / for C
- The camera tile (`.stage-self`) is hidden until a take starts (it was an empty box). If C restyles it, keep that or tell B.
