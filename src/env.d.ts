/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** package.json version, set in vite.config.ts. */
  readonly VITE_APP_VERSION: string
  /** The commit the build was made from, set in vite.config.ts. */
  readonly VITE_BUILD_COMMIT: string
}
