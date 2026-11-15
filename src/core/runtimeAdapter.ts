export function isTauriDesktop(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

export interface RustCentralEntry {
  file_name: string;
  compression_method: number;
  compressed_size: number;
  uncompressed_size: number;
  schwartz_key_preview: string;
}

export interface RustCbzIndexResponse {
  file_name: string;
  file_size: number;
  pages: RustCentralEntry[];
  comic_info_xml: string | null;
  central_dir_parse_ms: number;
  schwartz_sort_us: number;
  total_entries: number;
}

export async function invokeRustReadCentralDir(
  filePath: string
): Promise<RustCbzIndexResponse> {
  const { invoke } = await import('@tauri-apps/api/core');
  return await invoke<RustCbzIndexResponse>('read_cbz_central_directory', {
    filePath,
  });
}

export async function invokeRustExtractSinglePage(
  filePath: string,
  entryName: string
): Promise<Uint8Array> {
  const { invoke } = await import('@tauri-apps/api/core');
  const bytes = await invoke<number[]>('extract_cbz_page_bytes', {
    filePath,
    entryName,
  });
  return new Uint8Array(bytes);
}
