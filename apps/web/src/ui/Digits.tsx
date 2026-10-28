import "./ui.css";

/**
 * Numbers that change in place (scores, timers, countdowns) without the text
 * jiggling. Krona One has no tabular figures (its "1" is narrower than the
 * other digits, and `tabular-nums` changes nothing), so every digit sits in a
 * fixed cell 1ch wide: the width of "0", the widest digit in both of our faces.
 * Signs, colons and points keep their natural width.
 *
 * Inherits font and colour; pair with .t-score or .t-num for the type role.
 */
export function Digits({ value, className }: { value: string | number; className?: string }) {
  const text = String(value);
  return (
    <span className={`digits${className ? ` ${className}` : ""}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {[...text].map((ch, i) =>
          ch >= "0" && ch <= "9" ? (
            <span key={i} className="digit">
              {ch}
            </span>
          ) : (
            ch
          ),
        )}
      </span>
    </span>
  );
}
