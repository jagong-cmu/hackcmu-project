/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_POSTHOG_KEY?: string;
  readonly VITE_PUBLIC_POSTHOG_HOST?: string;
  readonly VITE_SOCKET_URL?: string;
  readonly VITE_LIVEKIT_WS_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Google OAuth web client id (public). Enables the GIS sign-in button; unset = redirect flow. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** Local dev only: "0" = play without accounts under `vite dev`. Ignored in builds. */
  readonly VITE_AUTH_REQUIRED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
