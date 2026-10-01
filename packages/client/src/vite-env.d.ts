/// <reference types="vite/client" />

/**
 * The build-time configuration this client reads. Declared so that a typo in a
 * variable name is a compile error rather than a silent `undefined` that falls
 * back to localhost in production.
 */
interface ImportMetaEnv {
  /** Where the server is. The page's own origin when unset. */
  readonly VITE_SERVER_URL?: string;
  /** "1" keeps the scenario viewer in a production build; see `scenarios/enabled.ts`. */
  readonly VITE_SCENARIOS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
