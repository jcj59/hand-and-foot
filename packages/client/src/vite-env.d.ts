/// <reference types="vite/client" />

/**
 * The build-time configuration this client reads. Declared so that a typo in a
 * variable name is a compile error rather than a silent `undefined` that falls
 * back to localhost in production.
 */
interface ImportMetaEnv {
  /** Where the server is. Defaults to the server's own default port when unset. */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
