import { SONGS, type MelodyFile, type SongMeta } from "@karaoke/shared";

export type ReadySong = SongMeta & { ready: boolean };

async function exists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    if (!res.ok) return false;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("text/html")) return false;
    return true;
  } catch {
    return false;
  }
}

export async function loadCatalog(): Promise<ReadySong[]> {
  let readyIds: Set<string> | null = null;
  try {
    const res = await fetch("/songs/manifest.json", { cache: "no-store" });
    if (res.ok) {
      const man = (await res.json()) as { ready?: string[] };
      if (Array.isArray(man.ready)) readyIds = new Set(man.ready);
    }
  } catch {
    readyIds = null;
  }

  return Promise.all(
    SONGS.map(async (s) => {
      if (readyIds && !readyIds.has(s.id)) return { ...s, ready: false };
      const base = `/songs/${s.id}`;
      const ready = (
        await Promise.all([
          exists(`${base}/melody.json`),
          exists(`${base}/lyrics.lrc`),
          exists(`${base}/meta.json`),
          exists(`${base}/instrumental.mp3`),
        ])
      ).every(Boolean);
      return { ...s, ready };
    }),
  );
}

export async function loadSongPack(id: string): Promise<{
  meta: SongMeta;
  melody: MelodyFile;
  lrc: string;
  audioUrl: string;
}> {
  const base = `/songs/${id}`;
  const [meta, melody, lrc] = await Promise.all([
    fetch(`${base}/meta.json`).then((r) => r.json() as Promise<SongMeta>),
    fetch(`${base}/melody.json`).then((r) => r.json() as Promise<MelodyFile>),
    fetch(`${base}/lyrics.lrc`).then((r) => r.text()),
  ]);
  return { meta, melody, lrc, audioUrl: `${base}/instrumental.mp3` };
}
