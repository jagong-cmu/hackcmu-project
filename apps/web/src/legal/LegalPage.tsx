import { useEffect, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { PageShell } from "../theme/PageShell.tsx";
import { privacyPolicy, termsOfService, type LegalDoc } from "./content.ts";
import { legalBodyHtml, legalFootHtml } from "./render.ts";
import "./legal.css";

/**
 * /privacy and /terms. Public (no sign-in). The text is rendered from the same
 * source as the static copies in dist/, so a crawler without JavaScript and a
 * visitor in the app read identical documents.
 */
function LegalPage({ doc }: { doc: LegalDoc }) {
  const navigate = useNavigate();

  useEffect(() => {
    const before = document.title;
    document.title = `${doc.title} · Aria`;
    if (!window.location.hash) window.scrollTo(0, 0);
    return () => {
      document.title = before;
    };
  }, [doc]);

  // The body is static markup; keep its same-site links inside the SPA.
  function onClick(e: MouseEvent<HTMLElement>) {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href") ?? "";
    if (!href.startsWith("/") || href.startsWith("//")) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    navigate(href);
  }

  return (
    <PageShell title={doc.title} wide bare className="legal-page">
      <article
        className="legal-doc"
        onClick={onClick}
        // Trusted, build-time content from content.ts, escaped by render.ts.
        dangerouslySetInnerHTML={{ __html: legalBodyHtml(doc) + legalFootHtml(doc) }}
      />
    </PageShell>
  );
}

export function PrivacyPolicy() {
  return <LegalPage doc={privacyPolicy} />;
}

export function TermsOfService() {
  return <LegalPage doc={termsOfService} />;
}
