/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_MODE?: 'mock' | 'http';
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_DEFAULT_LANG?: 'ko' | 'en' | 'ja' | 'zh';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Vite asset imports we use in the app
declare module '*.wasm?url' {
  const src: string;
  export default src;
}
