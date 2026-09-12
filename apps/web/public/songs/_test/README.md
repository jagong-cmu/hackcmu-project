# `_test` — Lane A click track

Not a real catalog song. This is a 60s metronome (880Hz ping on every second)
so Lane A can build and verify the shared clock before Lane B's instrumentals
land. Two laptops in sync should click as one sound; drift is audible instantly.

Enable it by setting `USE_TEST_SONG=1` in `.env` — the server then hands out
`_test` instead of a catalog song. Its metadata lives in `server/src/clock.ts`,
not in `packages/shared`, so the frozen catalog stays untouched.

60s covers every clip window: ranked 15s, duet 45s, chaos 60s.

**Lane B:** ignore this directory. Delete it after the real songs ship.
