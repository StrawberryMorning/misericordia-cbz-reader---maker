use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::cbz_engine::deve_usar_zip64;
use crate::schwartz::{eh_entrada_imagem_valida, ordenar_por_schwartz};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ComicInfoMetaRust {
    pub title: String,
    pub series: String,
    pub number: String,
    pub volume: String,
    pub writer: String,
    pub penciller: String,
    pub publisher: String,
    pub genre: String,
    pub year: String,
    pub language_iso: String,
    pub manga: String,
    pub summary: String,
    pub page_count: usize,
}

fn escapar_xml(texto: &str) -> String {
    texto
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn desescapar_xml(texto: &str) -> String {
    texto
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn extrair_tag_xml(xml: &str, tag: &str) -> String {
    let abertura = format!("<{}>", tag);
    let fechamento = format!("</{}>", tag);
    if let Some(ini) = xml.find(&abertura) {
        let apos_ini = ini + abertura.len();
        if let Some(fim) = xml[apos_ini..].find(&fechamento) {
            return desescapar_xml(xml[apos_ini..apos_ini + fim].trim());
        }
    }
    String::new()
}

impl ComicInfoMetaRust {
    pub fn from_xml(xml: &str) -> Self {
        let page_count = extrair_tag_xml(xml, "PageCount")
            .parse::<usize>()
            .unwrap_or(0);
        let manga_raw = extrair_tag_xml(xml, "Manga");
        let manga = if manga_raw == "Yes" || manga_raw == "YesAndRightToLeft" {
            "YesAndRightToLeft".to_string()
        } else {
            "No".to_string()
        };
        let lang = extrair_tag_xml(xml, "LanguageISO");

        Self {
            title: extrair_tag_xml(xml, "Title"),
            series: extrair_tag_xml(xml, "Series"),
            number: extrair_tag_xml(xml, "Number"),
            volume: extrair_tag_xml(xml, "Volume"),
            writer: extrair_tag_xml(xml, "Writer"),
            penciller: extrair_tag_xml(xml, "Penciller"),
            publisher: extrair_tag_xml(xml, "Publisher"),
            genre: extrair_tag_xml(xml, "Genre"),
            year: extrair_tag_xml(xml, "Year"),
            language_iso: if lang.is_empty() {
                "pt-BR".to_string()
            } else {
                lang
            },
            manga,
            summary: extrair_tag_xml(xml, "Summary"),
            page_count,
        }
    }

    pub fn to_xml(&self, tamanhos_paginas: &[u64]) -> String {
        let mut linhas = vec![
            r#"<?xml version="1.0" encoding="utf-8"?>"#.to_string(),
            r#"<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">"#.to_string(),
        ];

        let mut add_tag = |tag: &str, valor: &str| {
            let limpo = valor.trim();
            if !limpo.is_empty() {
                linhas.push(format!("  <{}>{}</{}>", tag, escapar_xml(limpo), tag));
            }
        };

        add_tag("Title", &self.title);
        add_tag("Series", &self.series);
        add_tag("Number", &self.number);
        add_tag("Volume", &self.volume);
        add_tag("Summary", &self.summary);
        add_tag("Year", &self.year);
        add_tag("Writer", &self.writer);
        add_tag("Penciller", &self.penciller);
        add_tag("Publisher", &self.publisher);
        add_tag("Genre", &self.genre);
        add_tag(
            "LanguageISO",
            if self.language_iso.is_empty() {
                "pt-BR"
            } else {
                &self.language_iso
            },
        );

        let total_pags = if tamanhos_paginas.is_empty() {
            self.page_count
        } else {
            tamanhos_paginas.len()
        };
        linhas.push(format!("  <PageCount>{}</PageCount>", total_pags));

        let manga_val = if self.manga.is_empty() {
            "No"
        } else {
            &self.manga
        };
        linhas.push(format!("  <Manga>{}</Manga>", escapar_xml(manga_val)));

        if !tamanhos_paginas.is_empty() {
            linhas.push("  <Pages>".to_string());
            for (idx, tam) in tamanhos_paginas.iter().enumerate() {
                let tipo = if idx == 0 {
                    r#" Type="FrontCover""#
                } else {
                    r#" Type="Story""#
                };
                linhas.push(format!(
                    r#"    <Page Image="{}" ImageSize="{}"{} />"#,
                    idx, tam, tipo
                ));
            }
            linhas.push("  </Pages>".to_string());
        }

        linhas.push("</ComicInfo>".to_string());
        linhas.join("\n")
    }
}

/// Atualiza ou injeta o ComicInfo.xml dentro de um arquivo .cbz existente,
/// preservando intactas todas as páginas de imagem.
pub fn atualizar_metadados_cbz<F>(
    caminho_origem: &str,
    caminho_destino: &str,
    mutador: F,
) -> Result<ComicInfoMetaRust, String>
where
    F: FnOnce(&mut ComicInfoMetaRust),
{
    let orig_file =
        File::open(caminho_origem).map_err(|e| format!("Erro ao abrir CBZ: {}", e))?;
    let mut archive =
        ZipArchive::new(orig_file).map_err(|e| format!("ZIP inválido: {}", e))?;

    let mut xml_existente = String::new();
    let mut nomes_imagens = Vec::new();
    let mut bytes_totais: u64 = 0;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let nome = entry.name().to_string();
        if nome.to_ascii_lowercase().ends_with("comicinfo.xml") {
            let _ = entry.read_to_string(&mut xml_existente);
        } else if eh_entrada_imagem_valida(&nome) {
            bytes_totais = bytes_totais.saturating_add(entry.size());
            nomes_imagens.push(nome);
        }
    }

    let (ordenadas, _) = ordenar_por_schwartz(nomes_imagens, |n| n.as_str());
    let mut meta = if xml_existente.is_empty() {
        ComicInfoMetaRust {
            language_iso: "pt-BR".to_string(),
            manga: "No".to_string(),
            page_count: ordenadas.len(),
            ..Default::default()
        }
    } else {
        ComicInfoMetaRust::from_xml(&xml_existente)
    };
    meta.page_count = ordenadas.len();

    mutador(&mut meta);

    let mesmo_arquivo = Path::new(caminho_origem) == Path::new(caminho_destino);
    let caminho_temp = if mesmo_arquivo {
        format!("{}.proselytize.tmp", caminho_destino)
    } else {
        caminho_destino.to_string()
    };

    let usar_zip64 = deve_usar_zip64(bytes_totais, ordenadas.len());
    let store_opts = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .large_file(usar_zip64);

    let mut tamanhos_paginas = Vec::with_capacity(ordenadas.len());
    let mut buffers_paginas: Vec<(String, Vec<u8>)> = Vec::with_capacity(ordenadas.len());

    for (nome_img, _) in &ordenadas {
        let mut entry = archive.by_name(nome_img).map_err(|e| e.to_string())?;
        let mut buf = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        tamanhos_paginas.push(buf.len() as u64);
        buffers_paginas.push((nome_img.clone(), buf));
    }

    let novo_xml = meta.to_xml(&tamanhos_paginas);

    {
        let out_file =
            File::create(&caminho_temp).map_err(|e| format!("Erro ao criar saída: {}", e))?;
        let mut writer = ZipWriter::new(out_file);

        writer
            .start_file("ComicInfo.xml", store_opts)
            .map_err(|e| e.to_string())?;
        writer
            .write_all(novo_xml.as_bytes())
            .map_err(|e| e.to_string())?;

        for (nome_img, bytes) in buffers_paginas {
            writer
                .start_file(nome_img, store_opts)
                .map_err(|e| e.to_string())?;
            writer.write_all(&bytes).map_err(|e| e.to_string())?;
        }

        writer.finish().map_err(|e| e.to_string())?;
    }

    if mesmo_arquivo {
        fs::rename(&caminho_temp, caminho_destino)
            .map_err(|e| format!("Falha ao substituir arquivo original: {}", e))?;
    }

    Ok(meta)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn testa_serializacao_e_parse_comic_info_xml() {
        let meta = ComicInfoMetaRust {
            title: "Romance Dawn".to_string(),
            series: "One Piece".to_string(),
            number: "1".to_string(),
            volume: "1".to_string(),
            writer: "Eiichiro Oda".to_string(),
            penciller: "Eiichiro Oda".to_string(),
            publisher: "Manhã de Morango S/A".to_string(),
            genre: "Aventura, Shounen".to_string(),
            year: "1997".to_string(),
            language_iso: "pt-BR".to_string(),
            manga: "YesAndRightToLeft".to_string(),
            summary: "O início da grande jornada pirata.".to_string(),
            page_count: 2,
        };

        let xml = meta.to_xml(&[150_000, 180_000]);
        assert!(xml.contains("<Title>Romance Dawn</Title>"));
        assert!(xml.contains("<Manga>YesAndRightToLeft</Manga>"));
        assert!(xml.contains(r#"<Page Image="0" ImageSize="150000" Type="FrontCover" />"#));

        let lido = ComicInfoMetaRust::from_xml(&xml);
        assert_eq!(lido.title, "Romance Dawn");
        assert_eq!(lido.series, "One Piece");
        assert_eq!(lido.writer, "Eiichiro Oda");
        assert_eq!(lido.publisher, "Manhã de Morango S/A");
        assert_eq!(lido.manga, "YesAndRightToLeft");
        assert_eq!(lido.page_count, 2);
    }
}
