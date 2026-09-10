/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_PHOTO_MAX_EDGE_PX?: string
  readonly VITE_PHOTO_JPEG_QUALITY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
