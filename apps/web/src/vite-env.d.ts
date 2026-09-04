/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Absolute base URL of the API, baked into the bundle at build time. Leave
   * unset to keep the relative `/api` base that the dev server proxies and the
   * nginx container reverse-proxies; set it only when the SPA and the API are
   * served from different origins, which then requires the API's CORS_ORIGINS
   * to name the web origin.
   */
  readonly VITE_API_URL?: string;
  /** Dev-server-only: where `/api` is proxied. Never reaches the bundle. */
  readonly VITE_API_PROXY_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
