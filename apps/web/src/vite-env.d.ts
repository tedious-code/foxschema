/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Build-time edition selector: 'community' | 'premium' | 'enterprise'. */
  readonly VITE_EDITION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
