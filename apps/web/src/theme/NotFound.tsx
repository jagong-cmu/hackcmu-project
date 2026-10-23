import { Link } from "react-router-dom";
import { PageShell } from "./PageShell.tsx";

/** Unknown paths land here instead of bouncing silently home. */
export function NotFound() {
  return (
    <PageShell title="Nothing here" tag="That page doesn't exist, or it moved.">
      <Link className="btn btn-primary" to="/">
        Back to the bar
      </Link>
    </PageShell>
  );
}
