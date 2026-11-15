pub mod cbz_engine;
pub mod comic_info;
pub mod schwartz;

use cbz_engine::{
    criar_cbz_com_nivel, criar_cbz_modo_store, extrair_bytes_pagina_cbz,
    ler_diretorio_central_cbz, RustCbzIndexResponse,
};

pub fn read_cbz_central_directory_cmd(file_path: String) -> Result<RustCbzIndexResponse, String> {
    ler_diretorio_central_cbz(&file_path)
}

pub fn extract_cbz_page_bytes_cmd(
    file_path: String,
    entry_name: String,
) -> Result<Vec<u8>, String> {
    extrair_bytes_pagina_cbz(&file_path, &entry_name)
}

pub fn create_cbz_store_archive_cmd(
    source_folder: String,
    output_cbz_path: String,
    comic_info_xml: Option<String>,
) -> Result<usize, String> {
    criar_cbz_modo_store(&source_folder, &output_cbz_path, comic_info_xml)
}

pub fn create_cbz_with_level_cmd(
    source_folder: String,
    output_cbz_path: String,
    comic_info_xml: Option<String>,
    compression_level: u8,
) -> Result<usize, String> {
    criar_cbz_com_nivel(
        &source_folder,
        &output_cbz_path,
        comic_info_xml,
        compression_level,
    )
}
