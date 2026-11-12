// Vite replaces import.meta.env.DEV in the Worker bundle too: true under `vite dev`, false in `vite build`.
interface ImportMetaEnv {
  readonly DEV: boolean;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
