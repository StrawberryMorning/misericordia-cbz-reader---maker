use misericordia_cbz_lib::cbz_engine::{
    extrair_bytes_pagina_cbz, ler_diretorio_central_cbz, RustCbzIndexResponse,
};
use misericordia_cbz_lib::comic_info::ComicInfoMetaRust;
use std::collections::HashMap;
use std::io::{self, Write};
use std::process::{Command, Stdio};

/// Gerenciador de Janela Deslizante [N-1 .. N+3] em memória para o Terminal CLI.
pub struct TerminalSlidingWindow {
    caminho_cbz: String,
    indice: RustCbzIndexResponse,
    pagina_atual: usize,
    cache: HashMap<usize, Vec<u8>>,
    paginas_revogadas: usize,
}

impl TerminalSlidingWindow {
    pub fn new(caminho_cbz: &str) -> Result<Self, String> {
        let indice = ler_diretorio_central_cbz(caminho_cbz)?;
        if indice.pages.is_empty() {
            return Err("Nenhuma página de imagem válida encontrada neste .cbz.".into());
        }

        let mut mgr = Self {
            caminho_cbz: caminho_cbz.to_string(),
            indice,
            pagina_atual: 0,
            cache: HashMap::new(),
            paginas_revogadas: 0,
        };
        mgr.navegar_para(0)?;
        Ok(mgr)
    }

    pub fn janela_valida(&self, centro: usize) -> (usize, usize) {
        let total = self.indice.pages.len();
        let ini = centro.saturating_sub(1);
        let fim = (centro + 3).min(total.saturating_sub(1));
        (ini, fim)
    }

    pub fn navegar_para(&mut self, destino: usize) -> Result<(), String> {
        let total = self.indice.pages.len();
        let clamped = destino.min(total.saturating_sub(1));
        self.pagina_atual = clamped;

        let (win_start, win_end) = self.janela_valida(clamped);

        // 1. Limpeza explícita da RAM (Eviction fora de [N-1 .. N+3])
        let mut removidas = 0;
        self.cache.retain(|&idx, _| {
            if idx < win_start || idx > win_end {
                removidas += 1;
                false
            } else {
                true
            }
        });
        self.paginas_revogadas += removidas;

        // 2. Pré-carregamento seletivo dos bytes da janela [N-1 .. N+3]
        let ordem = [
            clamped,
            clamped.saturating_add(1),
            clamped.saturating_sub(1),
            clamped.saturating_add(2),
            clamped.saturating_add(3),
        ];

        for &idx in &ordem {
            if idx >= win_start && idx <= win_end && !self.cache.contains_key(&idx) {
                let nome = &self.indice.pages[idx].file_name;
                if let Ok(bytes) = extrair_bytes_pagina_cbz(&self.caminho_cbz, nome) {
                    self.cache.insert(idx, bytes);
                }
            }
        }

        Ok(())
    }

    pub fn bytes_em_ram_na_janela(&self) -> usize {
        self.cache.values().map(|v| v.len()).sum()
    }
}

/// Converte bytes de imagem (JPG/PNG/WebP) em arte TrueColor 24-bit ANSI Half-Block (▀)
/// para visualização direta dentro do terminal.
fn renderizar_imagem_ansi_halfblock(bytes_imagem: &[u8], largura_colunas: u32) -> Result<String, String> {
    let altura_max_px = largura_colunas;

    let mut child = Command::new("magick")
        .args([
            "-",
            "-resize",
            &format!("{}x{}", largura_colunas, altura_max_px),
            "-depth",
            "8",
            "ppm:-",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "ImageMagick ('magick') não disponível para decodificar pixels no terminal.".to_string())?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(bytes_imagem);
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Falha ao decodificar imagem: {}", e))?;

    if !output.status.success() || output.stdout.len() < 15 {
        return Err("Não foi possível rasterizar a imagem para PPM.".into());
    }

    let ppm = &output.stdout;
    // Parse do cabeçalho PPM P6: "P6\n<W> <H>\n255\n"
    let mut pos = 0;
    let mut tokens = Vec::new();
    while tokens.len() < 4 && pos < ppm.len() {
        while pos < ppm.len() && ppm[pos].is_ascii_whitespace() {
            pos += 1;
        }
        if pos < ppm.len() && ppm[pos] == b'#' {
            while pos < ppm.len() && ppm[pos] != b'\n' {
                pos += 1;
            }
            continue;
        }
        let start = pos;
        while pos < ppm.len() && !ppm[pos].is_ascii_whitespace() {
            pos += 1;
        }
        if start < pos {
            tokens.push(String::from_utf8_lossy(&ppm[start..pos]).to_string());
        }
    }
    // Avança 1 byte de whitespace após "255"
    pos += 1;

    if tokens.len() < 4 || tokens[0] != "P6" {
        return Err("Cabeçalho PPM inválido.".into());
    }

    let width: usize = tokens[1].parse().unwrap_or(0);
    let height: usize = tokens[2].parse().unwrap_or(0);
    let pixels = &ppm[pos..];

    if width == 0 || height == 0 || pixels.len() < width * height * 3 {
        return Err("Buffer RGB incompleto.".into());
    }

    let mut ansi = String::with_capacity(width * height * 12);

    let mut y = 0;
    while y < height {
        ansi.push_str("  ");
        for x in 0..width {
            let top_idx = (y * width + x) * 3;
            let (r1, g1, b1) = (pixels[top_idx], pixels[top_idx + 1], pixels[top_idx + 2]);

            if y + 1 < height {
                let bot_idx = ((y + 1) * width + x) * 3;
                let (r2, g2, b2) = (pixels[bot_idx], pixels[bot_idx + 1], pixels[bot_idx + 2]);
                ansi.push_str(&format!(
                    "\x1b[38;2;{};{};{}m\x1b[48;2;{};{};{}m▀",
                    r1, g1, b1, r2, g2, b2
                ));
            } else {
                ansi.push_str(&format!("\x1b[38;2;{};{};{}m▀", r1, g1, b1));
            }
        }
        ansi.push_str("\x1b[0m\n");
        y += 2;
    }

    Ok(ansi)
}

fn exibir_pagina_terminal(mgr: &TerminalSlidingWindow, largura_cols: u32) {
    let idx = mgr.pagina_atual;
    let total = mgr.indice.pages.len();
    let entrada = &mgr.indice.pages[idx];
    let (win_start, win_end) = mgr.janela_valida(idx);

    println!("========================================================================");
    println!(
        "🍓 PROSELYTIZE TERMINAL READER • PÁGINA {}/{} • {}",
        idx + 1,
        total,
        mgr.indice.file_name
    );
    println!(
        "   Arquivo: {} | Chave Schwartz: {}",
        entrada.file_name, entrada.schwartz_key_preview
    );
    println!("------------------------------------------------------------------------");

    if let Some(bytes) = mgr.cache.get(&idx) {
        match renderizar_imagem_ansi_halfblock(bytes, largura_cols) {
            Ok(arte_ansi) => print!("{}", arte_ansi),
            Err(aviso) => println!("   [Visualização ANSI indisponível: {}]", aviso),
        }
    }

    println!("------------------------------------------------------------------------");
    // Barra de Status da Janela Deslizante [N-1 .. N+3]
    let mut slots_txt = Vec::new();
    for offset in -1isize..=3isize {
        let p_idx = idx as isize + offset;
        let label = if offset == 0 {
            format!("[*N={}*]", p_idx + 1)
        } else if offset > 0 {
            format!("N+{}:{}", offset, p_idx + 1)
        } else {
            format!("N{}:{}", offset, p_idx + 1)
        };

        if p_idx < 0 || p_idx >= total as isize {
            slots_txt.push(format!("{}(---)", label));
        } else if mgr.cache.contains_key(&(p_idx as usize)) {
            slots_txt.push(format!("{}(RAM✓)", label));
        } else {
            slots_txt.push(format!("{}(...)", label));
        }
    }

    println!(
        "⚡ Janela Deslizante [{}..{}]: {}",
        win_start + 1,
        win_end + 1,
        slots_txt.join(" | ")
    );
    println!(
        "   RAM Ativa na Janela: {:.1} KB ({} págs) • Páginas Revogadas da RAM: {}",
        mgr.bytes_em_ram_na_janela() as f64 / 1024.0,
        mgr.cache.len(),
        mgr.paginas_revogadas
    );
    println!("========================================================================");
}

pub fn executar_read_terminal(
    caminho_cbz: &str,
    pagina_1based: Option<usize>,
    largura_cols: u32,
) -> Result<(), String> {
    let mut mgr = TerminalSlidingWindow::new(caminho_cbz)?;
    let total = mgr.indice.pages.len();

    if let Some(p) = pagina_1based {
        if p == 0 || p > total {
            return Err(format!("Página {} inválida (o arquivo possui {} páginas).", p, total));
        }
        mgr.navegar_para(p - 1)?;
        exibir_pagina_terminal(&mgr, largura_cols);
        return Ok(());
    }

    // Modo Interativo no Terminal
    loop {
        exibir_pagina_terminal(&mgr, largura_cols);
        print!(
            "Comandos: [Enter/n] Próxima | [p] Anterior | [1..{}] Ir p/ Pág | [i] ComicInfo | [q] Sair > ",
            total
        );
        let _ = io::stdout().flush();

        let mut linha = String::new();
        if io::stdin().read_line(&mut linha).is_err() {
            break;
        }
        let cmd = linha.trim();

        if cmd == "q" || cmd == "quit" || cmd == "exit" {
            println!("👋 Encerrando Proselytize Terminal Reader. Memória da janela liberada!");
            break;
        } else if cmd.is_empty() || cmd == "n" || cmd == "next" {
            if mgr.pagina_atual + 1 < total {
                mgr.navegar_para(mgr.pagina_atual + 1)?;
            } else {
                println!("ℹ️ Você já está na última página ({}/{}).", total, total);
            }
        } else if cmd == "p" || cmd == "prev" {
            if mgr.pagina_atual > 0 {
                mgr.navegar_para(mgr.pagina_atual - 1)?;
            } else {
                println!("ℹ️ Você já está na primeira página (1/{}).", total);
            }
        } else if cmd == "i" || cmd == "info" {
            if let Some(xml) = &mgr.indice.comic_info_xml {
                let meta = ComicInfoMetaRust::from_xml(xml);
                println!(
                    "\n📋 ComicInfo.xml -> Título: '{}' | Série: '{}' | Autor: '{}' | Direção: {}\n",
                    meta.title, meta.series, meta.writer, meta.manga
                );
            } else {
                println!("\n📋 Este arquivo .cbz não possui ComicInfo.xml.\n");
            }
        } else if let Ok(num) = cmd.parse::<usize>() {
            if num >= 1 && num <= total {
                mgr.navegar_para(num - 1)?;
            } else {
                println!("⚠️ Informe uma página entre 1 e {}.", total);
            }
        }
    }

    Ok(())
}
