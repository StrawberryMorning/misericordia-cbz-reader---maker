use crate::schwartz::{
    eh_entrada_imagem_valida, formatar_nome_zero_padding, ordenar_por_schwartz,
};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::time::Instant;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustCentralEntry {
    pub file_name: String,
    pub compression_method: u16,
    pub compressed_size: u64,
    pub uncompressed_size: u64,
    pub schwartz_key_preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustCbzIndexResponse {
    pub file_name: String,
    pub file_size: u64,
    pub pages: Vec<RustCentralEntry>,
    pub comic_info_xml: Option<String>,
    pub central_dir_parse_ms: f64,
    pub schwartz_sort_us: u128,
    pub total_entries: usize,
}

/// Lê exclusivamente o Diretório Central no final do arquivo .cbz sem extrair as imagens para o disco/RAM.
pub fn ler_diretorio_central_cbz(caminho_cbz: &str) -> Result<RustCbzIndexResponse, String> {
    let t0 = Instant::now();
    let path = Path::new(caminho_cbz);
    let metadata = fs::metadata(path).map_err(|e| format!("Erro ao ler arquivo: {}", e))?;
    let file_size = metadata.len();

    let reader = File::open(path).map_err(|e| format!("Falha ao abrir CBZ: {}", e))?;
    let mut archive = ZipArchive::new(reader)
        .map_err(|e| format!("Falha ao ler Diretório Central ZIP: {}", e))?;

    let total_entries = archive.len();
    let mut entradas_brutas = Vec::new();
    let mut comic_info_xml = None;

    for i in 0..total_entries {
        let mut entry = archive
            .by_index_raw(i)
            .map_err(|e| format!("Erro no cabeçalho da entrada {}: {}", i, e))?;
        let name = entry.name().to_string();

        if name.to_ascii_lowercase().ends_with("comicinfo.xml") {
            drop(entry);
            if let Ok(mut xml_file) = archive.by_index(i) {
                let mut conteudo = String::new();
                if xml_file.read_to_string(&mut conteudo).is_ok() {
                    comic_info_xml = Some(conteudo);
                }
            }
        } else if eh_entrada_imagem_valida(&name) {
            let method = match entry.compression() {
                CompressionMethod::Stored => 0,
                CompressionMethod::Deflated => 8,
                _ => 99,
            };
            entradas_brutas.push((
                name,
                method,
                entry.compressed_size(),
                entry.size(),
            ));
        } else {
            let _ = &mut entry;
        }
    }

    let parse_ms = t0.elapsed().as_secs_f64() * 1000.0;

    let (ordenadas, schwartz_sort_us) =
        ordenar_por_schwartz(entradas_brutas, |tupla| tupla.0.as_str());

    let pages = ordenadas
        .into_iter()
        .map(|((file_name, compression_method, compressed_size, uncompressed_size), chave)| {
            RustCentralEntry {
                file_name,
                compression_method,
                compressed_size,
                uncompressed_size,
                schwartz_key_preview: chave.format_preview(),
            }
        })
        .collect();

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("archive.cbz")
        .to_string();

    Ok(RustCbzIndexResponse {
        file_name,
        file_size,
        pages,
        comic_info_xml,
        central_dir_parse_ms: (parse_ms * 100.0).round() / 100.0,
        schwartz_sort_us,
        total_entries,
    })
}

/// Extrai sob demanda apenas os bytes de uma única página solicitada pela janela deslizante [N-1 .. N+3].
pub fn extrair_bytes_pagina_cbz(
    caminho_cbz: &str,
    nome_entrada: &str,
) -> Result<Vec<u8>, String> {
    let reader = File::open(caminho_cbz).map_err(|e| format!("Falha ao abrir CBZ: {}", e))?;
    let mut archive =
        ZipArchive::new(reader).map_err(|e| format!("Erro no índice ZIP: {}", e))?;

    let mut entry = archive
        .by_name(nome_entrada)
        .map_err(|e| format!("Página '{}' não encontrada no ZIP: {}", nome_entrada, e))?;

    let mut buffer = Vec::with_capacity(entry.size() as usize);
    entry
        .read_to_end(&mut buffer)
        .map_err(|e| format!("Falha ao ler bytes da página: {}", e))?;

    Ok(buffer)
}

/// Empacota uma pasta de imagens em um arquivo .cbz no modo sem compressão (STORE / Nível 0),
/// aplicando a Transformada de Schwartz e renomeação com Zero-Padding.
pub fn criar_cbz_modo_store(
    pasta_origem: &str,
    caminho_saida_cbz: &str,
    comic_info_xml: Option<String>,
) -> Result<usize, String> {
    criar_cbz_com_nivel(pasta_origem, caminho_saida_cbz, comic_info_xml, 0)
}

const LIMITE_SEGURO_ZIP32_BYTES: u64 = 3_800_000_000;
const LIMITE_SEGURO_ZIP32_ENTRADAS: usize = 65_000;

/// Determina automaticamente se o pacote deve usar a extensão ZIP64.
pub fn deve_usar_zip64(total_bytes: u64, total_entradas: usize) -> bool {
    total_bytes >= LIMITE_SEGURO_ZIP32_BYTES || total_entradas >= LIMITE_SEGURO_ZIP32_ENTRADAS
}

/// Empacota uma pasta de imagens em um arquivo .cbz com nível de compressão configurável:
/// `0` = STORE (sem compressão), `1..=9` = DEFLATE.
/// Ativa automaticamente ZIP64 quando o total exceder ~3.8 GB ou 65.000 páginas.
pub fn criar_cbz_com_nivel(
    pasta_origem: &str,
    caminho_saida_cbz: &str,
    comic_info_xml: Option<String>,
    nivel_compressao: u8,
) -> Result<usize, String> {
    let dir_entries =
        fs::read_dir(pasta_origem).map_err(|e| format!("Erro ao ler pasta: {}", e))?;

    let mut caminhos_validos = Vec::new();
    let mut tamanho_total_estimado: u64 = 0;

    for entry_res in dir_entries {
        if let Ok(entry) = entry_res {
            let path = entry.path();
            if path.is_file() {
                if let Some(nome) = path.file_name().and_then(|n| n.to_str()) {
                    if eh_entrada_imagem_valida(nome) {
                        let tamanho_arquivo = entry.metadata().map(|m| m.len()).unwrap_or(0);
                        tamanho_total_estimado = tamanho_total_estimado.saturating_add(tamanho_arquivo);
                        caminhos_validos.push((nome.to_string(), path));
                    }
                }
            }
        }
    }

    if caminhos_validos.is_empty() {
        return Err("Nenhuma imagem válida (.jpg, .png, .webp) encontrada na pasta.".into());
    }

    let (ordenados, _) = ordenar_por_schwartz(caminhos_validos, |item| item.0.as_str());
    let total = ordenados.len();
    let usar_zip64 = deve_usar_zip64(tamanho_total_estimado, total);

    let arquivo_saida = File::create(caminho_saida_cbz)
        .map_err(|e| format!("Erro ao criar arquivo CBZ: {}", e))?;
    let mut zip_writer = ZipWriter::new(arquivo_saida);

    let zip_options = if nivel_compressao == 0 {
        SimpleFileOptions::default()
            .compression_method(CompressionMethod::Stored)
            .large_file(usar_zip64)
    } else {
        let clamped_level = nivel_compressao.min(9) as i64;
        SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .compression_level(Some(clamped_level))
            .large_file(usar_zip64)
    };

    if let Some(xml) = comic_info_xml {
        zip_writer
            .start_file("ComicInfo.xml", zip_options)
            .map_err(|e| e.to_string())?;
        zip_writer
            .write_all(xml.as_bytes())
            .map_err(|e| e.to_string())?;
    }

    for (idx, ((nome_original, caminho_completo), _chave)) in ordenados.into_iter().enumerate() {
        let nome_padronizado = formatar_nome_zero_padding(idx, total, &nome_original);
        let bytes = fs::read(&caminho_completo).map_err(|e| e.to_string())?;

        zip_writer
            .start_file(nome_padronizado, zip_options)
            .map_err(|e| e.to_string())?;
        zip_writer.write_all(&bytes).map_err(|e| e.to_string())?;
    }

    zip_writer.finish().map_err(|e| e.to_string())?;
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn testa_deteccao_automatica_zip64() {
        // Caso normal: 300 páginas (~90 MB) -> ZIP32 padrão
        assert!(!deve_usar_zip64(90_000_000, 300));
        // Caso One Piece: 21.500 páginas (~4.9 GB) -> Ativa ZIP64 automaticamente
        assert!(deve_usar_zip64(4_900_000_000, 21_500));
        // Caso muitas páginas pequenas (> 65.000 entradas) -> Ativa ZIP64
        assert!(deve_usar_zip64(500_000_000, 65_001));
    }
}
