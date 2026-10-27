import { useEffect, useState } from "react";
import { LeftFraction, MaxImageBytes, MaxLeftLuminance, MinImageWidth } from "./assetBrief.ts";
import { RoomIds, type RoomId } from "./rooms.ts";

type Row = {
  room: RoomId;
  found: string | null;
  bytes: number | null;
  width: number | null;
  blur: boolean;
  leftLum: number | null;
};

const lum = (r: number, g: number, b: number): number => {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

async function measure(room: RoomId): Promise<Row> {
  const row: Row = { room, found: null, bytes: null, width: null, blur: false, leftLum: null };
  for (const ext of ["avif", "webp"]) {
    const res = await fetch(`/rooms/${room}.${ext}`).catch(() => null);
    const type = res?.headers.get("content-type") ?? "";
    if (!res || !res.ok || !type.startsWith("image/")) continue;
    const blob = await res.blob();
    row.found = ext;
    row.bytes = blob.size;
    const bmp = await createImageBitmap(blob).catch(() => null);
    if (!bmp) break;
    row.width = bmp.width;
    const w = 320;
    const h = Math.round((bmp.height / bmp.width) * w);
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(bmp, 0, 0, w, h);
      const left = ctx.getImageData(0, 0, Math.round(w * LeftFraction), h).data;
      const ls: number[] = [];
      for (let i = 0; i < left.length; i += 4) ls.push(lum(left[i], left[i + 1], left[i + 2]));
      ls.sort((a, b) => a - b);
      row.leftLum = ls[Math.min(ls.length - 1, Math.floor(ls.length * 0.99))] ?? null;
    }
    break;
  }
  const blur = await fetch(`/rooms/${room}-blur.webp`).catch(() => null);
  row.blur = Boolean(blur?.ok && (blur.headers.get("content-type") ?? "").startsWith("image/"));
  return row;
}

const mark = (ok: boolean | null) => (ok == null ? "n/a" : ok ? "PASS" : "FAIL");

/** Dev-only (`/scene-check`): measures the delivered room images against scene/assetBrief.ts. */
export function SceneCheck() {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    void Promise.all(RoomIds.map(measure)).then(setRows);
  }, []);
  return (
    <main style={{ padding: "var(--sp-6)", maxWidth: "70rem" }}>
      <h1 className="display" style={{ fontSize: "var(--text-2xl)" }}>Room images vs the asset brief</h1>
      <p className="text-meta">
        At most {MaxImageBytes / 1024} KB each, at least {MinImageWidth}px wide, a blurred placeholder, and the left{" "}
        {LeftFraction * 100}% no brighter than {MaxLeftLuminance} (99th percentile luminance). Files go in
        apps/web/public/rooms/ (see README.md there).
      </p>
      {!rows ? (
        <p>Measuring…</p>
      ) : (
        <table className="board" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>Room</th>
              <th>File</th>
              <th>Size</th>
              <th>Width</th>
              <th>Placeholder</th>
              <th>Left brightness</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.room}>
                <td>{r.room}</td>
                <td>{r.found ?? "missing (solid fallback in use)"}</td>
                <td>
                  {r.bytes != null ? `${Math.round(r.bytes / 1024)} KB ` : ""}
                  {mark(r.bytes == null ? null : r.bytes <= MaxImageBytes)}
                </td>
                <td>
                  {r.width ?? "-"} {mark(r.width == null ? null : r.width >= MinImageWidth)}
                </td>
                <td>{r.found ? mark(r.blur) : mark(null)}</td>
                <td>
                  {r.leftLum != null ? `${r.leftLum.toFixed(3)} ` : ""}
                  {mark(r.leftLum == null ? null : r.leftLum <= MaxLeftLuminance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
