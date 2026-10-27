import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { navigate } from "./menuNav.ts";
import "./menu.css";

export type MenuItem = {
  id: string;
  label: string;
  /** One plain line shown under the list while this item is selected. */
  desc?: string;
  /** Smaller, below the main items (leaderboard, settings). */
  secondary?: boolean;
  disabled?: boolean;
  /** Replaces the label while set (an inline field, e.g. the room code). */
  content?: ReactNode;
  onActivate: () => void;
};

/**
 * A plain left-aligned game menu. One red indicator marks the selected item and
 * moves instantly. The indicator follows keyboard focus; hovering also selects.
 * Roving tabindex: the list is one tab stop, arrow keys move within it.
 */
export function MenuList({
  items,
  label,
  onSelectionChange,
  onBack,
}: {
  items: MenuItem[];
  label: string;
  onSelectionChange?: (item: MenuItem) => void;
  onBack?: () => void;
}) {
  const [index, setIndex] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const disabled = new Set(items.flatMap((it, i) => (it.disabled ? [i] : [])));

  useEffect(() => {
    const it = items[index];
    if (it) onSelectionChange?.(it);
    // Only when the selection moves, not whenever the items array is rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  function onKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    // Typing in an inline field belongs to the field, except Escape (handled there).
    if (e.target instanceof HTMLInputElement) return;
    const r = navigate({ index, count: items.length, disabled }, e.key);
    if (r.index !== index) {
      e.preventDefault();
      setIndex(r.index);
      refs.current[r.index]?.focus();
    } else if (r.action === "back" && onBack) {
      e.preventDefault();
      onBack();
    }
    // Enter and Space activate the focused button natively.
  }

  const main = items.filter((i) => !i.secondary);
  const rest = items.filter((i) => i.secondary);
  const renderItem = (it: MenuItem) => {
    const i = items.indexOf(it);
    return (
      <li key={it.id}>
        <button
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          className={`menu-item${it.secondary ? " is-secondary" : ""}`}
          data-selected={i === index ? "true" : "false"}
          aria-current={i === index ? "true" : undefined}
          disabled={it.disabled}
          tabIndex={i === index ? 0 : -1}
          onFocus={() => setIndex(i)}
          onMouseEnter={() => !it.disabled && setIndex(i)}
          onClick={it.onActivate}
        >
          {it.content ?? it.label}
        </button>
      </li>
    );
  };

  return (
    <nav className="menu" aria-label={label}>
      <ul className="menu-list" onKeyDown={onKeyDown}>
        {main.map(renderItem)}
      </ul>
      {rest.length ? (
        <ul className="menu-list menu-list-secondary" onKeyDown={onKeyDown}>
          {rest.map(renderItem)}
        </ul>
      ) : null}
      <p className="menu-desc" aria-live="polite">
        {items[index]?.desc ?? " "}
      </p>
    </nav>
  );
}
