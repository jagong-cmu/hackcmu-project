/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_POSTHOG_KEY?: string;
  readonly VITE_PUBLIC_POSTHOG_HOST?: string;
  readonly VITE_SOCKET_URL?: string;
  readonly VITE_LIVEKIT_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
