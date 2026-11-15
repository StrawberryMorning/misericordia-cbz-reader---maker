use misericordia_cbz_lib::cbz_engine::{
    extrair_bytes_pagina_cbz, ler_diretorio_central_cbz,
};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::process::{Command, Stdio};

const HTML_READER_TEMPLATE: &str = r#"<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Proselytize Reader • Manhã de Morango S/A</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #09090b; color: #f4f4f5; font-family: system-ui, -apple-system, sans-serif; height: 100vh; display: flex; flex-direction: column; overflow: hidden; user-select: none; }
    header { height: 52px; background: rgba(24,24,27,0.95); border-bottom: 1px solid #27272a; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; z-index: 20; }
    .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .title { font-weight: 800; background: linear-gradient(90deg,#fb7185,#fbbf24); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 16px; }
    .badge { font-size: 11px; padding: 2px 8px; border-radius: 99px; background: rgba(244,63,94,0.15); color: #fda4af; border: 1px solid rgba(244,63,94,0.3); font-family: monospace; white-space: nowrap; }
    .controls { display: flex; align-items: center; gap: 8px; }
    button { background: #27272a; color: #e4e4e7; border: 1px solid #3f3f46; padding: 6px 11px; border-radius: 8px; font-size: 12px; cursor: pointer; font-weight: 600; }
    button:hover { background: #3f3f46; }
    button.close-btn { background: rgba(244,63,94,0.22); color: #fecdd3; border-color: rgba(244,63,94,0.5); }
    button.close-btn:hover { background: rgba(244,63,94,0.35); }
    #viewport { flex: 1; position: relative; display: flex; align-items: center; justify-content: center; overflow: hidden; touch-action: none; background: #09090b; }
    #page-img { max-height: calc(100vh - 102px); width: auto; object-fit: contain; box-shadow: 0 20px 50px rgba(0,0,0,0.85); pointer-events: none; transition: transform 0.1s ease-out; }
    .edge-zone { position: absolute; top: 0; bottom: 0; width: 16%; max-width: 140px; z-index: 10; cursor: pointer; display: flex; align-items: center; background: transparent; border: none; }
    .edge-left { left: 0; justify-content: flex-start; padding-left: 14px; }
    .edge-right { right: 0; justify-content: flex-end; padding-right: 14px; }
    .edge-arrow { opacity: 0; transition: opacity 0.15s; background: rgba(24,24,27,0.85); border: 1px solid #3f3f46; color: #f4f4f5; width: 38px; height: 38px; border-radius: 99px; display: flex; align-items: center; justify-content: center; font-size: 16px; }
    .edge-zone:hover .edge-arrow { opacity: 1; }
    .zoom-pill { position: absolute; top: 14px; right: 14px; background: rgba(24,24,27,0.9); border: 1px solid #3f3f46; padding: 5px 9px; border-radius: 10px; display: flex; align-items: center; gap: 7px; font-family: monospace; font-size: 12px; z-index: 15; }
    .hud-pill { position: absolute; bottom: 14px; left: 14px; background: rgba(24,24,27,0.88); border: 1px solid #27272a; padding: 6px 10px; border-radius: 9px; font-family: monospace; font-size: 11px; color: #a1a1aa; z-index: 15; }
    footer { height: 48px; background: rgba(24,24,27,0.95); border-top: 1px solid #27272a; display: flex; align-items: center; gap: 14px; padding: 0 16px; z-index: 20; }
    input[type=range] { flex: 1; accent-color: #f43f5e; cursor: pointer; }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <button class="close-btn" onclick="closeReader()" title="Fechar Leitor (Esc)">✕ Fechar</button>
      <span class="title">Proselytize</span>
      <span class="badge">Manhã de Morango S/A</span>
      <span id="file-label" style="font-size:12px;color:#d4d4d8;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Carregando...</span>
    </div>
    <div class="controls">
      <button id="dir-btn" onclick="toggleDir()" title="Atalho: M">Ocidental (→)</button>
      <button onclick="toggleFit()" id="fit-btn" title="Atalho: V">Ajuste: Altura</button>
      <button onclick="toggleFullscreen()" title="Tela Cheia (F)">⛶</button>
    </div>
  </header>
  <div id="viewport">
    <button class="edge-zone edge-left" onclick="edgeClick(-1)" aria-label="Esquerda"><span class="edge-arrow">◀</span></button>
    <button class="edge-zone edge-right" onclick="edgeClick(1)" aria-label="Direita"><span class="edge-arrow">▶</span></button>
    <div class="zoom-pill">
      <button onclick="changeZoom(-0.25)">-</button>
      <span id="zoom-txt">100%</span>
      <button onclick="changeZoom(0.25)">+</button>
      <button onclick="resetZoom()">Reset</button>
    </div>
    <img id="page-img" alt="Página" />
    <div class="hud-pill" id="hud-txt">Janela Deslizante [N-1..N+3]</div>
  </div>
  <footer>
    <button onclick="step(-1)">◀</button>
    <span id="page-counter" style="font-family:monospace;font-size:12px;color:#fda4af;min-width:90px;">Pág 1 / 1</span>
    <input id="scrubber" type="range" min="0" max="0" value="0" oninput="goTo(parseInt(this.value,10))" />
    <button onclick="step(1)">▶</button>
  </footer>
  <script>
    let pages = [];
    let current = 0;
    let rtl = false;
    let fitWidth = false;
    let zoom = 1;
    let panX = 0, panY = 0, dragging = false, startX = 0, startY = 0;
    let closedSent = false;
    const cache = new Map(); // Sliding Window [N-1 .. N+3]
    let evicted = 0;

    function notifyShutdown() {
      if (closedSent) return;
      closedSent = true;
      try { navigator.sendBeacon('/api/shutdown'); } catch {}
    }

    function closeReader() {
      notifyShutdown();
      window.close();
    }

    window.addEventListener('beforeunload', notifyShutdown);

    async function init() {
      const params = new URLSearchParams(window.location.search);
      const startPage = Math.max(0, (parseInt(params.get('page') || '1', 10) || 1) - 1);
      const res = await fetch('/api/index');
      const data = await res.json();
      pages = data.pages || [];
      document.title = `${data.file_name} • Proselytize Reader`;
      document.getElementById('file-label').textContent = `${data.file_name} (${pages.length} págs • EOCD: ${data.central_dir_parse_ms}ms)`;
      document.getElementById('scrubber').max = Math.max(0, pages.length - 1);
      if (data.comic_info_xml && data.comic_info_xml.includes('YesAndRightToLeft')) {
        rtl = true;
        document.getElementById('dir-btn').textContent = 'Mangá RTL (←)';
      }
      goTo(startPage);
    }

    async function goTo(idx) {
      if (!pages.length) return;
      current = Math.max(0, Math.min(pages.length - 1, idx));
      resetZoom();
      const winStart = Math.max(0, current - 1);
      const winEnd = Math.min(pages.length - 1, current + 3);

      for (const [k, url] of cache.entries()) {
        if (k < winStart || k > winEnd) {
          URL.revokeObjectURL(url);
          cache.delete(k);
          evicted++;
        }
      }

      const order = [current, current + 1, current - 1, current + 2, current + 3]
        .filter(i => i >= winStart && i <= winEnd);

      for (const i of order) {
        if (!cache.has(i)) {
          fetch(`/api/page/${i}`).then(r => r.blob()).then(b => {
            const u = URL.createObjectURL(b);
            cache.set(i, u);
            if (i === current) render();
            updateHud(winStart, winEnd);
          });
        }
      }
      render();
      updateHud(winStart, winEnd);
    }

    function render() {
      const img = document.getElementById('page-img');
      if (cache.has(current)) img.src = cache.get(current);
      document.getElementById('page-counter').textContent = `Pág ${current + 1} / ${pages.length}`;
      document.getElementById('scrubber').value = current;
      document.getElementById('scrubber').style.transform = rtl ? 'scaleX(-1)' : 'none';
    }

    function updateHud(ws, we) {
      document.getElementById('hud-txt').textContent =
        `Janela [${ws + 1}..${we + 1}] • RAM: ${cache.size}/5 • Liberadas: ${evicted}`;
    }

    function edgeClick(dir) {
      if (zoom > 1.05) return;
      step(dir);
    }

    function step(delta) {
      const dir = rtl ? -delta : delta;
      goTo(current + dir);
    }
    function toggleDir() {
      rtl = !rtl;
      document.getElementById('dir-btn').textContent = rtl ? 'Mangá RTL (←)' : 'Ocidental (→)';
      render();
    }
    function toggleFit() {
      fitWidth = !fitWidth;
      const img = document.getElementById('page-img');
      img.style.maxHeight = fitWidth ? 'none' : 'calc(100vh - 102px)';
      img.style.width = fitWidth ? '90vw' : 'auto';
      document.getElementById('fit-btn').textContent = fitWidth ? 'Ajuste: Largura' : 'Ajuste: Altura';
    }
    function toggleFullscreen() {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
      else document.exitFullscreen().catch(() => {});
    }
    function applyTransform() {
      const img = document.getElementById('page-img');
      img.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`;
      document.getElementById('zoom-txt').textContent = `${Math.round(zoom * 100)}%`;
      document.getElementById('viewport').style.cursor = zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default';
    }
    function changeZoom(d) {
      zoom = Math.max(1, Math.min(3.5, +(zoom + d).toFixed(2)));
      if (zoom === 1) { panX = 0; panY = 0; }
      applyTransform();
    }
    function resetZoom() {
      zoom = 1; panX = 0; panY = 0; applyTransform();
    }

    const vp = document.getElementById('viewport');
    vp.addEventListener('wheel', e => {
      e.preventDefault();
      changeZoom(e.deltaY < 0 ? 0.15 : -0.15);
    }, { passive: false });
    vp.addEventListener('mousedown', e => {
      if (zoom <= 1) return;
      dragging = true; startX = e.clientX - panX; startY = e.clientY - panY; applyTransform();
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      panX = e.clientX - startX; panY = e.clientY - startY; applyTransform();
    });
    window.addEventListener('mouseup', () => { dragging = false; applyTransform(); });
    window.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') step(1);
      else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') step(-1);
      else if (e.key === ' ') { e.preventDefault(); step(1); }
      else if (e.key === 'm' || e.key === 'M') toggleDir();
      else if (e.key === 'v' || e.key === 'V') toggleFit();
      else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
      else if (e.key === 'Escape') {
        if (zoom > 1) resetZoom();
        else closeReader();
      }
    });
    init();
  </script>
</body>
</html>"#;

fn inferir_mime(nome: &str) -> &'static str {
    let lower = nome.to_ascii_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else {
        "image/jpeg"
    }
}

/// Tenta abrir uma janela dedicada sem barras de navegador (--app=URL) usando Brave/Chrome/Edge;
/// caso nenhum esteja instalado, faz fallback para xdg-open.
fn abrir_janela_dedicada(url: &str) {
    let navegadores_app = [
        "brave-browser",
        "google-chrome",
        "chromium",
        "chromium-browser",
        "microsoft-edge",
    ];

    for bin in &navegadores_app {
        let existe = Command::new("which")
            .arg(bin)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        if existe {
            let spawn_res = Command::new(bin)
                .arg(format!("--app={}", url))
                .arg("--window-size=1280,860")
                .arg("--class=ProselytizeReader")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();

            if spawn_res.is_ok() {
                return;
            }
        }
    }

    let _ = Command::new("xdg-open")
        .arg(url)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
}

pub fn iniciar_servidor_visual_cbz(
    caminho_cbz: &str,
    porta_preferida: Option<u16>,
    abrir_interface: bool,
    modo_janela_propria: bool,
    pagina_inicial: Option<usize>,
) -> Result<(), String> {
    let indice = ler_diretorio_central_cbz(caminho_cbz)?;
    if indice.pages.is_empty() {
        return Err("Nenhuma página válida encontrada neste .cbz.".into());
    }

    let endereco_bind = format!("127.0.0.1:{}", porta_preferida.unwrap_or(0));
    let listener = TcpListener::bind(&endereco_bind)
        .map_err(|e| format!("Falha ao iniciar servidor local: {}", e))?;

    let addr_real = listener.local_addr().map_err(|e| e.to_string())?;
    let mut url = format!("http://{}", addr_real);
    if let Some(p) = pagina_inicial {
        url.push_str(&format!("?page={}", p));
    }

    println!("==================================================================");
    println!("🍓 PROSELYTIZE READER • Manhã de Morango S/A");
    println!("==================================================================");
    println!(
        "Arquivo:   {} ({} páginas • EOCD: {:.2} ms)",
        indice.file_name,
        indice.pages.len(),
        indice.central_dir_parse_ms
    );
    println!("URL Local: {}", url);
    println!("Feche a janela do leitor (ou aperte Esc) para voltar ao terminal.");
    println!("==================================================================");

    if abrir_interface {
        if modo_janela_propria {
            abrir_janela_dedicada(&url);
        } else {
            let _ = Command::new("xdg-open").arg(&url).spawn();
        }
    }

    let json_indice = serde_json::to_string(&indice).unwrap_or_else(|_| "{}".to_string());

    for stream_res in listener.incoming() {
        if let Ok(mut stream) = stream_res {
            let mut buffer = [0u8; 2048];
            let lidos = stream.read(&mut buffer).unwrap_or(0);
            if lidos == 0 {
                continue;
            }
            let req = String::from_utf8_lossy(&buffer[..lidos]);
            let primeira_linha = req.lines().next().unwrap_or("");
            let caminho_http = primeira_linha
                .split_whitespace()
                .nth(1)
                .unwrap_or("/")
                .split('?')
                .next()
                .unwrap_or("/");

            if caminho_http == "/api/shutdown" {
                let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
                println!("👋 Janela do leitor fechada. Memória liberada!");
                break;
            } else if caminho_http == "/api/index" {
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    json_indice.len(),
                    json_indice
                );
                let _ = stream.write_all(resp.as_bytes());
            } else if let Some(idx_str) = caminho_http.strip_prefix("/api/page/") {
                if let Ok(idx) = idx_str.parse::<usize>() {
                    if let Some(pag) = indice.pages.get(idx) {
                        if let Ok(bytes) = extrair_bytes_pagina_cbz(caminho_cbz, &pag.file_name) {
                            let mime = inferir_mime(&pag.file_name);
                            let cabecalho = format!(
                                "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
                                mime,
                                bytes.len()
                            );
                            let _ = stream.write_all(cabecalho.as_bytes());
                            let _ = stream.write_all(&bytes);
                            continue;
                        }
                    }
                }
                let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
            } else {
                let corpo = HTML_READER_TEMPLATE.as_bytes();
                let cabecalho = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    corpo.len()
                );
                let _ = stream.write_all(cabecalho.as_bytes());
                let _ = stream.write_all(corpo);
            }
        }
    }

    Ok(())
}
