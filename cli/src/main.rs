mod local_viewer_server;
mod terminal_reader;

use local_viewer_server::iniciar_servidor_visual_cbz;
use misericordia_cbz_lib::cbz_engine::{
    criar_cbz_com_nivel, descompactar_cbz, ler_diretorio_central_cbz,
};
use misericordia_cbz_lib::comic_info::{atualizar_metadados_cbz, ComicInfoMetaRust};
use std::env;
use std::process;
use terminal_reader::executar_read_terminal;

const VERSION: &str = "1.1.0";

fn imprimir_ajuda() {
    println!("==================================================================");
    println!("🍓 Proselytize CLI v{} • Manhã de Morango S/A ™", VERSION);
    println!("   Motor Rust de Alta Performance para CBZ & ComicInfo.xml");
    println!("==================================================================\n");
    println!("USO:");
    println!("  proselytize <COMANDO> [ARGUMENTOS]\n");
    println!("COMANDOS:");
    println!("  read <arquivo.cbz> [--page <N>] [--width <COLUNAS>]");
    println!("      Renderiza e lê o quadrinho diretamente DENTRO do terminal em");
    println!("      TrueColor 24-bit ANSI (▀) com Janela Deslizante [N-1..N+3] ativa.\n");
    println!("  open <arquivo.cbz> [--port <PORTA>] [--no-browser]");
    println!("      Sobe um servidor local instantâneo em Rust e abre o arquivo .cbz");
    println!("      direto na interface visual do Proselytize Reader.\n");
    println!("  unpack <arquivo.cbz> [-o <pasta_destino>] [--page <N>]");
    println!("      Extrai todas as páginas (ou apenas a página --page N) do .cbz");
    println!("      já ordenadas e padronizadas para uma pasta no disco.\n");
    println!("  info <arquivo.cbz>");
    println!("      Lê exclusivamente o Diretório Central do ZIP e exibe o índice,");
    println!("      chaves da Transformada de Schwartz e metadados do ComicInfo.xml.\n");
    println!("  meta <arquivo.cbz> [OPÇÕES]");
    println!("      Edita ou injeta metadados ComicInfo.xml preservando as imagens:");
    println!("        --title <TEXTO>       Define o Título da edição");
    println!("        --series <TEXTO>      Define o nome da Série");
    println!("        --volume <NUM>        Define o Volume");
    println!("        --number <NUM>        Define o Número da edição");
    println!("        --writer <TEXTO>      Define o Roteirista/Autor");
    println!("        --penciller <TEXTO>   Define o Desenhista");
    println!("        --publisher <TEXTO>   Define a Editora");
    println!("        --genre <TEXTO>       Define os Gêneros");
    println!("        --year <ANO>          Define o Ano de publicação");
    println!("        --language <ISO>      Define o Idioma (ex: pt-BR)");
    println!("        --summary <TEXTO>     Define a Sinopse");
    println!("        --manga               Define direção Mangá RTL (YesAndRightToLeft)");
    println!("        --ltr                 Define direção Ocidental LTR (No)");
    println!("        -o, --output <ARQ>    Salva em novo arquivo (padrão: atualiza in-place)\n");
    println!("  pack <pasta_origem> -o <saida.cbz> [OPÇÕES]");
    println!("      Empacota uma pasta de imagens aplicando a Transformada de Schwartz,");
    println!("      renomeação Zero-Padding (001.jpg), detecção automática de ZIP64 e");
    println!("      geração opcional de ComicInfo.xml:");
    println!("        -o, --output <ARQ>    Caminho do arquivo .cbz de saída");
    println!("        --level <0..9>        Nível de compressão ZIP (0 = STORE padrão)");
    println!("        --title <TEXTO>       Título para o ComicInfo.xml");
    println!("        --series <TEXTO>      Série para o ComicInfo.xml");
    println!("        --writer <TEXTO>      Autor para o ComicInfo.xml");
    println!("        --manga               Marca como Mangá RTL no ComicInfo.xml\n");
}

fn formatar_bytes(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.2} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

fn executar_read(args: &[String]) -> Result<(), String> {
    let arquivo = args
        .first()
        .ok_or_else(|| "Informe o arquivo .cbz. Ex: proselytize read manga.cbz".to_string())?;

    let mut pagina: Option<usize> = None;
    let mut largura: u32 = 64;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--page" | "-p" => {
                i += 1;
                if let Some(p_str) = args.get(i) {
                    pagina = p_str.parse::<usize>().ok();
                }
            }
            "--width" | "-w" => {
                i += 1;
                if let Some(w_str) = args.get(i) {
                    largura = w_str.parse::<u32>().unwrap_or(64).clamp(24, 160);
                }
            }
            outro => {
                return Err(format!("Argumento desconhecido em 'read': {}", outro));
            }
        }
        i += 1;
    }

    executar_read_terminal(arquivo, pagina, largura)
}

fn executar_open(args: &[String]) -> Result<(), String> {
    let arquivo = args
        .first()
        .ok_or_else(|| "Informe o arquivo .cbz. Ex: proselytize open manga.cbz".to_string())?;

    let mut porta: Option<u16> = None;
    let mut abrir_navegador = true;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--port" | "-p" => {
                i += 1;
                if let Some(p_str) = args.get(i) {
                    porta = p_str.parse::<u16>().ok();
                }
            }
            "--no-browser" => {
                abrir_navegador = false;
            }
            outro => {
                return Err(format!("Argumento desconhecido em 'open': {}", outro));
            }
        }
        i += 1;
    }

    iniciar_servidor_visual_cbz(arquivo, porta, abrir_navegador)
}

fn executar_unpack(args: &[String]) -> Result<(), String> {
    let arquivo = args
        .first()
        .ok_or_else(|| "Informe o arquivo .cbz. Ex: proselytize unpack manga.cbz -o ./extraido".to_string())?;

    let mut pasta_destino = format!("{}_extracted", arquivo.trim_end_matches(".cbz"));
    let mut pagina: Option<usize> = None;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "-o" | "--output" => {
                i += 1;
                if let Some(out) = args.get(i) {
                    pasta_destino = out.clone();
                }
            }
            "--page" | "-p" => {
                i += 1;
                if let Some(p_str) = args.get(i) {
                    pagina = p_str.parse::<usize>().ok();
                }
            }
            outro => {
                return Err(format!("Argumento desconhecido em 'unpack': {}", outro));
            }
        }
        i += 1;
    }

    let total = descompactar_cbz(arquivo, &pasta_destino, pagina)?;
    println!(
        "✅ Extraídas {} página(s) de '{}' para a pasta '{}'!",
        total, arquivo, pasta_destino
    );
    Ok(())
}

fn executar_info(args: &[String]) -> Result<(), String> {
    let arquivo = args
        .first()
        .ok_or_else(|| "Informe o caminho do arquivo .cbz. Ex: proselytize info manga.cbz".to_string())?;

    let resumo = ler_diretorio_central_cbz(arquivo)?;

    println!("==================================================================");
    println!("📖 PROSELYTIZE INSPECTOR • v{} (Manhã de Morango S/A)", VERSION);
    println!("==================================================================");
    println!("Arquivo:             {} ({})", resumo.file_name, formatar_bytes(resumo.file_size));
    println!("Total no ZIP:        {} entradas ({} páginas válidas)", resumo.total_entries, resumo.pages.len());
    println!("Parse Diretório:     {:.2} ms (Leitura Seletiva EOCD)", resumo.central_dir_parse_ms);
    println!("Schwartz Sort O(N):  {} µs", resumo.schwartz_sort_us);

    println!("------------------------------------------------------------------");
    if let Some(xml) = &resumo.comic_info_xml {
        let meta = ComicInfoMetaRust::from_xml(xml);
        println!("📋 METADADOS COMICINFO.XML ENCONTRADOS:");
        println!("  Título:            {}", if meta.title.is_empty() { "—" } else { &meta.title });
        println!("  Série:             {}", if meta.series.is_empty() { "—" } else { &meta.series });
        println!("  Volume / Número:   Vol. {} • #{}",
            if meta.volume.is_empty() { "—" } else { &meta.volume },
            if meta.number.is_empty() { "—" } else { &meta.number }
        );
        println!("  Roteirista:        {}", if meta.writer.is_empty() { "—" } else { &meta.writer });
        println!("  Desenhista:        {}", if meta.penciller.is_empty() { "—" } else { &meta.penciller });
        println!("  Editora:           {}", if meta.publisher.is_empty() { "—" } else { &meta.publisher });
        println!("  Gênero / Ano:      {} ({})",
            if meta.genre.is_empty() { "—" } else { &meta.genre },
            if meta.year.is_empty() { "—" } else { &meta.year }
        );
        println!("  Idioma / Direção:  {} • {}", meta.language_iso, meta.manga);
        if !meta.summary.is_empty() {
            println!("  Sinopse:           {}", meta.summary);
        }
    } else {
        println!("📋 METADADOS COMICINFO.XML: [Ausente na raiz deste CBZ]");
    }

    println!("------------------------------------------------------------------");
    println!("📑 AMOSTRA DO ÍNDICE DE PÁGINAS (Transformada de Schwartz):");
    for (idx, p) in resumo.pages.iter().take(5).enumerate() {
        let metodo = if p.compression_method == 0 { "STORE" } else { "DEFLATE" };
        println!(
            "  #{:03} -> {} ({}, {}) | Chave: {}",
            idx + 1,
            p.file_name,
            formatar_bytes(p.uncompressed_size),
            metodo,
            p.schwartz_key_preview
        );
    }
    if resumo.pages.len() > 5 {
        println!("  ... (+{} páginas no índice)", resumo.pages.len() - 5);
    }
    println!("==================================================================");
    Ok(())
}

fn executar_meta(args: &[String]) -> Result<(), String> {
    if args.is_empty() {
        return Err("Informe o arquivo .cbz. Ex: proselytize meta cap01.cbz --title \"Capítulo 1\"".into());
    }

    let arquivo_origem = &args[0];
    let mut arquivo_saida = arquivo_origem.clone();

    let mut title: Option<String> = None;
    let mut series: Option<String> = None;
    let mut volume: Option<String> = None;
    let mut number: Option<String> = None;
    let mut writer: Option<String> = None;
    let mut penciller: Option<String> = None;
    let mut publisher: Option<String> = None;
    let mut genre: Option<String> = None;
    let mut year: Option<String> = None;
    let mut language: Option<String> = None;
    let mut summary: Option<String> = None;
    let mut manga: Option<String> = None;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--title" => {
                i += 1;
                title = args.get(i).cloned();
            }
            "--series" => {
                i += 1;
                series = args.get(i).cloned();
            }
            "--volume" => {
                i += 1;
                volume = args.get(i).cloned();
            }
            "--number" => {
                i += 1;
                number = args.get(i).cloned();
            }
            "--writer" | "--author" => {
                i += 1;
                writer = args.get(i).cloned();
            }
            "--penciller" => {
                i += 1;
                penciller = args.get(i).cloned();
            }
            "--publisher" => {
                i += 1;
                publisher = args.get(i).cloned();
            }
            "--genre" => {
                i += 1;
                genre = args.get(i).cloned();
            }
            "--year" => {
                i += 1;
                year = args.get(i).cloned();
            }
            "--language" => {
                i += 1;
                language = args.get(i).cloned();
            }
            "--summary" => {
                i += 1;
                summary = args.get(i).cloned();
            }
            "--manga" => {
                manga = Some("YesAndRightToLeft".to_string());
            }
            "--ltr" => {
                manga = Some("No".to_string());
            }
            "-o" | "--output" => {
                i += 1;
                if let Some(out) = args.get(i) {
                    arquivo_saida = out.clone();
                }
            }
            outro => {
                return Err(format!("Argumento desconhecido em 'meta': {}", outro));
            }
        }
        i += 1;
    }

    let meta_final = atualizar_metadados_cbz(arquivo_origem, &arquivo_saida, |m| {
        if let Some(v) = title {
            m.title = v;
        }
        if let Some(v) = series {
            m.series = v;
        }
        if let Some(v) = volume {
            m.volume = v;
        }
        if let Some(v) = number {
            m.number = v;
        }
        if let Some(v) = writer {
            m.writer = v;
        }
        if let Some(v) = penciller {
            m.penciller = v;
        }
        if let Some(v) = publisher {
            m.publisher = v;
        }
        if let Some(v) = genre {
            m.genre = v;
        }
        if let Some(v) = year {
            m.year = v;
        }
        if let Some(v) = language {
            m.language_iso = v;
        }
        if let Some(v) = summary {
            m.summary = v;
        }
        if let Some(v) = manga {
            m.manga = v;
        }
    })?;

    println!("✅ ComicInfo.xml atualizado com sucesso em '{}'!", arquivo_saida);
    println!(
        "   Título: '{}' | Série: '{}' | Autor: '{}' | Páginas: {} | Direção: {}",
        meta_final.title,
        meta_final.series,
        meta_final.writer,
        meta_final.page_count,
        meta_final.manga
    );
    Ok(())
}

fn executar_pack(args: &[String]) -> Result<(), String> {
    if args.is_empty() {
        return Err("Informe a pasta de origem. Ex: proselytize pack ./imagens -o cap01.cbz".into());
    }

    let pasta_origem = &args[0];
    let mut saida_cbz = String::from("proselytize_output.cbz");
    let mut nivel: u8 = 0;
    let mut meta = ComicInfoMetaRust {
        language_iso: "pt-BR".to_string(),
        manga: "No".to_string(),
        publisher: "Manhã de Morango S/A".to_string(),
        ..Default::default()
    };
    let mut gerar_xml = false;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "-o" | "--output" => {
                i += 1;
                if let Some(out) = args.get(i) {
                    saida_cbz = out.clone();
                }
            }
            "--level" => {
                i += 1;
                if let Some(lvl_str) = args.get(i) {
                    nivel = lvl_str.parse::<u8>().unwrap_or(0).min(9);
                }
            }
            "--title" => {
                i += 1;
                if let Some(v) = args.get(i) {
                    meta.title = v.clone();
                    gerar_xml = true;
                }
            }
            "--series" => {
                i += 1;
                if let Some(v) = args.get(i) {
                    meta.series = v.clone();
                    gerar_xml = true;
                }
            }
            "--writer" | "--author" => {
                i += 1;
                if let Some(v) = args.get(i) {
                    meta.writer = v.clone();
                    gerar_xml = true;
                }
            }
            "--manga" => {
                meta.manga = "YesAndRightToLeft".to_string();
                gerar_xml = true;
            }
            outro => {
                return Err(format!("Argumento desconhecido em 'pack': {}", outro));
            }
        }
        i += 1;
    }

    let xml_opcional = if gerar_xml {
        Some(meta.to_xml(&[]))
    } else {
        None
    };

    let total_paginas = criar_cbz_com_nivel(pasta_origem, &saida_cbz, xml_opcional, nivel)?;
    println!(
        "✅ Pacote '{}' gerado com sucesso! ({} páginas ordenadas via Schwartz • Nível ZIP: {})",
        saida_cbz, total_paginas, nivel
    );
    Ok(())
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.is_empty() {
        imprimir_ajuda();
        return;
    }

    let resultado = match args[0].as_str() {
        "-h" | "--help" | "help" => {
            imprimir_ajuda();
            Ok(())
        }
        "-v" | "--version" | "version" => {
            println!("proselytize v{} (Manhã de Morango S/A ™)", VERSION);
            Ok(())
        }
        "read" => executar_read(&args[1..]),
        "open" => executar_open(&args[1..]),
        "unpack" => executar_unpack(&args[1..]),
        "info" => executar_info(&args[1..]),
        "meta" => executar_meta(&args[1..]),
        "pack" => executar_pack(&args[1..]),
        cmd => Err(format!(
            "Comando desconhecido: '{}'. Use 'proselytize --help' para ver os comandos.",
            cmd
        )),
    };

    if let Err(erro) = resultado {
        eprintln!("❌ Erro: {}", erro);
        process::exit(1);
    }
}
