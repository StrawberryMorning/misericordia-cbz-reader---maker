use std::path::Path;
use std::time::Instant;

#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum Segmento {
    Numero(u64),
    Texto(String),
}

#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct ChaveOrdenacao {
    pub segmentos: Vec<Segmento>,
    pub nome_original: String,
}

impl ChaveOrdenacao {
    pub fn format_preview(&self) -> String {
        let parts: Vec<String> = self
            .segmentos
            .iter()
            .map(|seg| match seg {
                Segmento::Numero(n) => format!("#{}", n),
                Segmento::Texto(s) => format!("\"{}\"", s),
            })
            .collect();
        format!("[{}]", parts.join(", "))
    }
}

/// Filtra arquivos válidos de imagem, descartando arquivos ocultos ou de sistema operacional.
pub fn eh_entrada_imagem_valida(caminho: &str) -> bool {
    let normalizado = caminho.replace('\\', "/");
    if normalizado.is_empty() || normalizado.ends_with('/') {
        return false;
    }

    for parte in normalizado.split('/') {
        if parte.is_empty() {
            continue;
        }
        let lower = parte.to_ascii_lowercase();
        if parte.starts_with('.')
            || lower == "__macosx"
            || lower == ".ds_store"
            || lower == "thumbs.db"
            || lower == "desktop.ini"
            || lower == "comicinfo.xml"
        {
            return false;
        }
    }

    let path = Path::new(&normalizado);
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => matches!(
            ext.to_ascii_lowercase().as_str(),
            "jpg" | "jpeg" | "png" | "webp" | "gif" | "avif" | "bmp"
        ),
        None => false,
    }
}

/// Extrai a chave estruturada (Transformada de Schwartz / Key Extraction) em passo único O(N).
pub fn extrair_chave_schwartz(nome: &str) -> ChaveOrdenacao {
    let normalizado = nome.replace('\\', "/");
    let bytes = normalizado.as_bytes();
    let len = bytes.len();
    let mut segmentos = Vec::new();
    let mut i = 0;

    while i < len {
        if bytes[i].is_ascii_digit() {
            let inicio = i;
            while i < len && bytes[i].is_ascii_digit() {
                i += 1;
            }
            let num_str = &normalizado[inicio..i];
            let valor = num_str.parse::<u64>().unwrap_or(0);
            segmentos.push(Segmento::Numero(valor));
        } else {
            let inicio = i;
            while i < len && !bytes[i].is_ascii_digit() {
                i += 1;
            }
            let texto = normalizado[inicio..i].to_lowercase();
            segmentos.push(Segmento::Texto(texto));
        }
    }

    ChaveOrdenacao {
        segmentos,
        nome_original: nome.to_string(),
    }
}

/// Ordena qualquer coleção usando a Transformada de Schwartz (Key Extraction única vez + comparação primitiva).
pub fn ordenar_por_schwartz<T, F>(
    itens: Vec<T>,
    extrator_nome: F,
) -> (Vec<(T, ChaveOrdenacao)>, u128)
where
    F: Fn(&T) -> &str,
{
    let inicio = Instant::now();

    // Passo 1: Extração de chaves O(N) uma única vez
    let mut indexados: Vec<(ChaveOrdenacao, T)> = itens
        .into_iter()
        .map(|item| {
            let chave = extrair_chave_schwartz(extrator_nome(&item));
            (chave, item)
        })
        .collect();

    // Passo 2: Ordenação O(N log N) sobre inteiros/tuplas primitivas
    indexados.sort_by(|a, b| a.0.cmp(&b.0));

    // Passo 3: Projeção de saída
    let resultado = indexados
        .into_iter()
        .map(|(chave, item)| (item, chave))
        .collect();

    let duracao_us = inicio.elapsed().as_micros().max(1);
    (resultado, duracao_us)
}

/// Renomeia a entrada com preenchimento de zeros à esquerda (ex: 001.jpg, 002.jpg) ajustado ao total de páginas.
pub fn formatar_nome_zero_padding(
    indice_zero_based: usize,
    total_paginas: usize,
    nome_original: &str,
) -> String {
    let digitos = total_paginas.to_string().len().max(3);
    let ext = Path::new(nome_original)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_else(|| "jpg".to_string());

    format!(
        "{:0width$}.{}",
        indice_zero_based + 1,
        ext,
        width = digitos
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn testa_transformada_de_schwartz_ordenacao_natural() {
        let arquivos = vec![
            "capitulo_1_pagina_10.jpg".to_string(),
            "capitulo_1_pagina_2.jpg".to_string(),
            "capitulo_1_pagina_1.jpg".to_string(),
            "capitulo_1_pagina_20.jpg".to_string(),
        ];

        let (ordenados, _) = ordenar_por_schwartz(arquivos, |s| s.as_str());
        let nomes: Vec<String> = ordenados.into_iter().map(|(nome, _)| nome).collect();

        assert_eq!(
            nomes,
            vec![
                "capitulo_1_pagina_1.jpg",
                "capitulo_1_pagina_2.jpg",
                "capitulo_1_pagina_10.jpg",
                "capitulo_1_pagina_20.jpg",
            ]
        );
    }

    #[test]
    fn testa_zero_padding() {
        assert_eq!(formatar_nome_zero_padding(0, 45, "scan_1.webp"), "001.webp");
        assert_eq!(
            formatar_nome_zero_padding(9, 1200, "scan_10.PNG"),
            "0010.png"
        );
    }
}
