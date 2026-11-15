use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

fn obter_home() -> Result<PathBuf, String> {
    env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| "Variável de ambiente HOME não definida.".to_string())
}

fn escapar_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn percent_encode_uri_path(path: &str) -> String {
    let mut out = String::with_capacity(path.len() + 16);
    for byte in path.as_bytes() {
        let is_unreserved = byte.is_ascii_alphanumeric()
            || matches!(byte, b'/' | b'-' | b'_' | b'.' | b'~');
        if is_unreserved {
            out.push(*byte as char);
        } else {
            out.push_str(&format!("%{:02X}", byte));
        }
    }
    out
}

fn calcular_md5(texto: &str) -> Option<String> {
    let mut child = Command::new("md5sum")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(texto.as_bytes());
    }

    let output = child.wait_with_output().ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.split_whitespace().next().map(|s| s.to_string())
}

fn caminho_executavel_preferido(home: &Path) -> Result<String, String> {
    let local_bin = home.join(".local/bin/proselytize");
    if local_bin.exists() {
        return Ok(local_bin.to_string_lossy().to_string());
    }

    let exe = env::current_exe()
        .map_err(|e| format!("Não foi possível localizar o executável atual: {}", e))?;
    Ok(exe.to_string_lossy().to_string())
}

/// Remove miniaturas antigas do cache Freedesktop e solicita ao Tumbler a regeneração.
pub fn executar_thumb_refresh(arquivos: &[String]) -> Result<(), String> {
    if arquivos.is_empty() {
        return Err("Informe ao menos um arquivo .cbz para atualizar a miniatura.".into());
    }

    let home = obter_home()?;
    let cache_base = home.join(".cache/thumbnails");
    let subpastas_cache = [
        "normal",
        "large",
        "x-large",
        "xx-large",
        "fail/gnome-thumbnail-factory",
    ];

    let mut uris = Vec::new();
    let mut mimes = Vec::new();

    for arquivo in arquivos {
        let abs = fs::canonicalize(arquivo)
            .map_err(|e| format!("Erro ao localizar '{}': {}", arquivo, e))?;
        let uri = format!("file://{}", percent_encode_uri_path(&abs.to_string_lossy()));

        if let Some(md5) = calcular_md5(&uri) {
            for sub in &subpastas_cache {
                let cached = cache_base.join(sub).join(format!("{}.png", md5));
                if cached.exists() {
                    let _ = fs::remove_file(cached);
                }
            }
        }

        uris.push(format!("'{}'", uri.replace('\'', "%27")));
        mimes.push("'application/vnd.comicbook+zip'".to_string());
    }

    // Solicita regeneração assíncrona ao daemon Tumbler (se disponível no D-Bus)
    let _ = Command::new("gdbus")
        .args([
            "call",
            "--session",
            "--dest",
            "org.freedesktop.thumbnails.Thumbnailer1",
            "--object-path",
            "/org/freedesktop/thumbnails/Thumbnailer1",
            "--method",
            "org.freedesktop.thumbnails.Thumbnailer1.Queue",
            &format!("[{}]", uris.join(", ")),
            &format!("[{}]", mimes.join(", ")),
            "large",
            "foreground",
            "0",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    println!(
        "✅ Miniatura(s) atualizada(s) para {} arquivo(s) .cbz!",
        arquivos.len()
    );
    Ok(())
}

fn remover_acoes_proselytize_existentes(xml: &str) -> String {
    let mut resultado = String::with_capacity(xml.len());
    let mut restante = xml;

    while let Some(inicio) = restante.find("<action>") {
        resultado.push_str(&restante[..inicio]);
        let apos_inicio = &restante[inicio..];
        if let Some(fim_rel) = apos_inicio.find("</action>") {
            let fim = fim_rel + "</action>".len();
            let bloco = &apos_inicio[..fim];
            if !bloco.contains("proselytize-action-") {
                resultado.push_str(bloco);
            }
            restante = apos_inicio[fim..].trim_start_matches(['\r', '\n']);
            if !bloco.contains("proselytize-action-") && !restante.is_empty() {
                resultado.push('\n');
            }
        } else {
            resultado.push_str(apos_inicio);
            restante = "";
            break;
        }
    }

    resultado.push_str(restante);
    resultado
}

fn gerar_bloco_acoes_thunar(exe_escaped: &str) -> String {
    format!(
        r#"<action>
	<icon>accessories-text-editor</icon>
	<name>Ler no Proselytize</name>
	<submenu>Proselytize</submenu>
	<unique-id>proselytize-action-read</unique-id>
	<command>{exe} read %f</command>
	<description>Abre o arquivo .cbz no leitor dedicado do Proselytize</description>
	<range>1-1</range>
	<patterns>*.cbz;*.CBZ</patterns>
	<other-files/>
</action>
<action>
	<icon>view-refresh</icon>
	<name>Atualizar miniatura (Thumb)</name>
	<submenu>Proselytize</submenu>
	<unique-id>proselytize-action-thumb</unique-id>
	<command>{exe} thumb --refresh %F</command>
	<description>Regenera a miniatura da capa para os arquivos .cbz selecionados</description>
	<range></range>
	<patterns>*.cbz;*.CBZ</patterns>
	<other-files/>
</action>
<action>
	<icon>package-x-generic</icon>
	<name>Descompactar CBZ</name>
	<submenu>Proselytize</submenu>
	<unique-id>proselytize-action-unpack</unique-id>
	<command>{exe} unpack %F</command>
	<description>Extrai os arquivos .cbz selecionados para pastas com o mesmo nome</description>
	<range></range>
	<patterns>*.cbz;*.CBZ</patterns>
	<other-files/>
</action>
<action>
	<icon>archive-insert</icon>
	<name>Compactar para CBZ (Padrão)</name>
	<submenu>Proselytize</submenu>
	<unique-id>proselytize-action-pack-store</unique-id>
	<command>{exe} pack --auto-name --level 0 %F</command>
	<description>Empacota a pasta de imagens em .cbz sem compressão (STORE)</description>
	<range></range>
	<patterns>*</patterns>
	<directories/>
</action>
<action>
	<icon>archive-insert</icon>
	<name>Compactar para CBZ (Otimizado)</name>
	<submenu>Proselytize</submenu>
	<unique-id>proselytize-action-pack-opt</unique-id>
	<command>{exe} pack --auto-name --level 6 %F</command>
	<description>Empacota a pasta de imagens em .cbz com compressão ZIP nível 6</description>
	<range></range>
	<patterns>*</patterns>
	<directories/>
</action>"#,
        exe = exe_escaped
    )
}

/// Instala thumbnailer, arquivo .desktop e ações de clique direito no Thunar.
pub fn executar_install_linux() -> Result<(), String> {
    let home = obter_home()?;
    let exe = caminho_executavel_preferido(&home)?;
    let exe_escaped = escapar_xml(&exe);

    // 1. Thumbnailer
    let dir_thumb = home.join(".local/share/thumbnailers");
    fs::create_dir_all(&dir_thumb)
        .map_err(|e| format!("Erro ao criar {:?}: {}", dir_thumb, e))?;
    let arq_thumb = dir_thumb.join("proselytize-cbz.thumbnailer");
    let conteudo_thumb = format!(
        "[Thumbnailer Entry]\nTryExec={exe}\nExec={exe} thumb %i %o %s\nMimeType=application/vnd.comicbook+zip;application/x-cbz;\n"
    );
    fs::write(&arq_thumb, conteudo_thumb)
        .map_err(|e| format!("Erro ao gravar {:?}: {}", arq_thumb, e))?;

    // 2. Desktop entry ("Abrir com Proselytize")
    let dir_apps = home.join(".local/share/applications");
    fs::create_dir_all(&dir_apps)
        .map_err(|e| format!("Erro ao criar {:?}: {}", dir_apps, e))?;
    let arq_desktop = dir_apps.join("proselytize.desktop");
    let conteudo_desktop = format!(
        "[Desktop Entry]\nType=Application\nName=Proselytize\nComment=Leitor e Criador de Quadrinhos CBZ\nExec=\"{exe}\" read %f\nIcon=applications-graphics\nTerminal=false\nCategories=Graphics;Viewer;\nMimeType=application/vnd.comicbook+zip;application/x-cbz;\n"
    );
    fs::write(&arq_desktop, conteudo_desktop)
        .map_err(|e| format!("Erro ao gravar {:?}: {}", arq_desktop, e))?;

    // 3. Thunar Custom Actions (uca.xml) com merge seguro
    let dir_thunar = home.join(".config/Thunar");
    fs::create_dir_all(&dir_thunar)
        .map_err(|e| format!("Erro ao criar {:?}: {}", dir_thunar, e))?;
    let arq_uca = dir_thunar.join("uca.xml");

    let uca_base = if arq_uca.exists() {
        fs::read_to_string(&arq_uca)
            .map_err(|e| format!("Erro ao ler {:?}: {}", arq_uca, e))?
    } else {
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<actions>\n</actions>\n".to_string()
    };

    let uca_limpo = remover_acoes_proselytize_existentes(&uca_base);
    let bloco_novas = gerar_bloco_acoes_thunar(&exe_escaped);

    let uca_final = if let Some(pos) = uca_limpo.rfind("</actions>") {
        let antes = uca_limpo[..pos].trim_end();
        format!("{}\n{}\n</actions>\n", antes, bloco_novas)
    } else {
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<actions>\n{}\n</actions>\n",
            bloco_novas
        )
    };

    fs::write(&arq_uca, uca_final)
        .map_err(|e| format!("Erro ao gravar {:?}: {}", arq_uca, e))?;

    println!("✅ Integração Linux instalada com sucesso!");
    println!("   • Thumbnailer: {}", arq_thumb.display());
    println!("   • Desktop App: {}", arq_desktop.display());
    println!("   • Menu Thunar: {}", arq_uca.display());
    println!("\n💡 Dica: Se o Thunar já estiver aberto, reinicie-o com 'thunar -q' para carregar o novo submenu 'Proselytize'.");

    Ok(())
}
