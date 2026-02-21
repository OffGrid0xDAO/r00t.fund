/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ZKAMM_ADDRESS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
