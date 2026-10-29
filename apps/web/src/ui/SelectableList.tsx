import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { navigate } from "./menuNav.ts";
import "./ui.css";

export type ListItem = {
  id: string;
  label: string;
  /** One plain line shown under the list while this item is selected. */
  desc?: string;
  /** Smaller, in a second group below the main items (leaderboard, settings). */
  secondary?: boolean;
  disabled?: boolean;
  /** Replaces the label (an inline field, or a grid cell's own markup). */
  content?: ReactNode;
  onActivate: () => void;
};

/**
 * A keyboard-first list: a vertical menu (columns 1) or a grid (columns > 1).
 * Arrows move (menuNav.ts), Enter/Space activate, Esc calls onBack. Hovering
 * selects too, so mouse and keyboard never disagree. One red triangle marks
 * the selection and slides between rows (transform only).
 * Roving tabindex: the list is one tab stop.
 */
export function SelectableList({
  items,
  label,
  columns = 1,
  className = "",
  initialId,
  autoFocus = false,
  onSelectionChange,
  onBack,
}: {
  items: ListItem[];
  /** Accessible name for the list (aria-label). */
  label: string;
  columns?: number;
  className?: string;
  /** Starts here instead of the first enabled item (e.g. the remembered choice). */
  initialId?: string;
  /** Focus the selected item once the items exist, so the arrows work straight away. */
  autoFocus?: boolean;
  onSelectionChange?: (item: ListItem) => void;
  onBack?: () => void;
}) {
  const start = () => {
    const i = items.findIndex((it) => it.id === initialId && !it.disabled);
    return i >= 0 ? i : Math.max(0, items.findIndex((it) => !it.disabled));
  };
  const [index, setIndex] = useState(start);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const navRef = useRef<HTMLElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  const disabled = new Set(items.flatMap((it, i) => (it.disabled ? [i] : [])));

  // Items can arrive after mount (a loaded catalogue): start there once they do.
  const hasItems = items.length > 0;
  useEffect(() => {
    if (!hasItems) return;
    const i = start();
    setIndex(i);
    if (autoFocus) refs.current[i]?.focus({ preventScroll: true });
    // Once, when the items first exist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasItems]);

  useEffect(() => {
    const it = items[index];
    if (it) onSelectionChange?.(it);
    // Only when the selection moves, not whenever the items array is rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Park the indicator beside the selected item. Measured, so it works for
  // rows of any height, both groups, and grids.
  useLayoutEffect(() => {
    const place = () => {
      const nav = navRef.current;
      const el = refs.current[index];
      const mark = markRef.current;
      if (!nav || !el || !mark) return;
      const n = nav.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      mark.style.transform = `translate(${r.left - n.left}px, ${r.top - n.top + r.height / 2}px) translateY(-50%)`;
      mark.style.fontSize = getComputedStyle(el).fontSize;
    };
    place();
    const ro = new ResizeObserver(place);
    if (navRef.current) ro.observe(navRef.current);
    return () => ro.disconnect();
  }, [index, items.length]);

  function onKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    // Typing in an inline field belongs to the field.
    if (e.target instanceof HTMLInputElement) return;
    const r = navigate({ index, count: items.length, columns, disabled }, e.key);
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

  const renderItem = (it: ListItem) => {
    const i = items.indexOf(it);
    return (
      <li key={it.id}>
        <button
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          className={`sl-item${it.secondary ? " is-secondary" : ""}${it.content ? " is-custom" : ""}`}
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

  const main = items.filter((i) => !i.secondary);
  const rest = items.filter((i) => i.secondary);
  return (
    <nav ref={navRef} className={`sl${columns > 1 ? " sl-grid" : ""} ${className}`.trim()} aria-label={label}>
      <span ref={markRef} className="sl-mark" aria-hidden="true" />
      <ul
        className="sl-list"
        style={columns > 1 ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
        onKeyDown={onKeyDown}
      >
        {main.map(renderItem)}
      </ul>
      {rest.length ? (
        <ul className="sl-list sl-list-secondary" onKeyDown={onKeyDown}>
          {rest.map(renderItem)}
        </ul>
      ) : null}
      {items.some((it) => it.desc) ? (
        <p className="sl-desc t-desc" aria-live="polite">
          {items[index]?.desc ?? " "}
        </p>
      ) : null}
    </nav>
  );
}
