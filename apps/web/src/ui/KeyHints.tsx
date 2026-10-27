import "./menu.css";

export type KeyHint = { keys: string[]; label: string };

export const MenuHints: KeyHint[] = [
  { keys: ["↑", "↓"], label: "Move" },
  { keys: ["Enter"], label: "Select" },
  { keys: ["Esc"], label: "Back" },
];

/** Small key glyphs with labels, bottom-right on every screen that takes keys. */
export function KeyHints({ hints = MenuHints }: { hints?: KeyHint[] }) {
  return (
    <footer className="key-hints" aria-label="Keyboard shortcuts">
      {hints.map((h) => (
        <span key={h.label} className="key-hint">
          {h.keys.map((k) => (
            <kbd key={k}>{k}</kbd>
          ))}
          {h.label}
        </span>
      ))}
    </footer>
  );
}
