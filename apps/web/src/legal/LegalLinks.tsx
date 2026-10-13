import { Link } from "react-router-dom";
import "./legal.css";

/** "Privacy · Terms" small print (Home footer, Settings). */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav className={["legal-links", className ?? ""].filter(Boolean).join(" ")} aria-label="Legal">
      <Link to="/privacy">Privacy Policy</Link>
      <Link to="/terms">Terms of Service</Link>
    </nav>
  );
}

/** Under the sign-in button. */
export function SignInAgreement() {
  return (
    <p className="auth-legal">
      By continuing you agree to the <Link to="/terms">Terms of Service</Link> and{" "}
      <Link to="/privacy">Privacy Policy</Link>.
    </p>
  );
}
