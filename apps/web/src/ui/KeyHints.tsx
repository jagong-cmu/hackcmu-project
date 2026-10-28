import "./ui.css";

export type Hint = { keys: string[]; label: string };

export const MenuHints: Hint[] = [
  { keys: ["↑", "↓"], label: "Move" },
  { keys: ["Enter"], label: "Select" },
  { keys: ["Esc"], label: "Back" },
];

/** One hint: keycaps followed by what they do. */
export function KeyHint({ keys, label }: Hint) {
  return (
    <span className="key-hint">
      {keys.map((k) => (
        <kbd key={k}>{k}</kbd>
      ))}
      {label}
    </span>
  );
}

/** The footer row of hints, bottom-right on every screen that takes keys. */
export function KeyHintBar({ hints = MenuHints }: { hints?: Hint[] }) {
  return (
    <footer className="key-hints" aria-label="Keyboard shortcuts">
      {hints.map((h) => (
        <KeyHint key={h.label} {...h} />
      ))}
    </footer>
  );
}
