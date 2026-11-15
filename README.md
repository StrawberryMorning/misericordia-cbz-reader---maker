# Proselytize (v1.0.0)
### Por Manhã de Morango S/A &trade;

<div align="center">
  <img src="public/brand/strawberry-elephant.jpg" width="140" alt="Elefante Morango - Manhã de Morango S/A" style="border-radius: 20px;" />
  <br />
  <strong>"Abandonando formatos obsoletos para a nova fé da alta performance digital."</strong>
</div>

---

**Proselytize** é uma suíte de alta performance para leitura (**CBZ Reader**) e conversão/padronização (**CBZ Converter & Maker**) de quadrinhos e mangás digitais (`.cbz`), com motor em **Rust (Tauri)** para Desktop e **React + TypeScript + Tailwind CSS** na Web/Vercel.

---

## Arquitetura Técnica

### 1. Transformada de Schwartz (*Key Extraction*) — Ordenação Natural $O(N)$ + Primitivas
Em vez de executar expressões regulares ou parsing repetido de strings a cada comparação ($O(N \log N)$ pesado), o motor extrai **uma única vez** uma chave estruturada de segmentos alternados `[Texto(String), Numero(u64/BigInt)]`:
- `capitulo_1_pagina_2.jpg` $\rightarrow$ `["capitulo_", #1, "_pagina_", #2, ".jpg"]`
- `capitulo_1_pagina_10.jpg` $\rightarrow$ `["capitulo_", #1, "_pagina_", #10, ".jpg"]`

A ordenação compara diretamente inteiros primitivos em 1 ciclo de clock, garantindo que arquivos sem zeros à esquerda fiquem na sequência real.

### 2. CBZ Maker (Modo `STORE` Nível 0 + `ComicInfo.xml`)
1. **Filtro de Entrada:** Mantém exclusivamente formatos de imagem válidos (`JPG`, `PNG`, `WebP`, `GIF`, `AVIF`), descartando arquivos ocultos ou de sistema (`.DS_Store`, `Thumbs.db`, `__MACOSX`).
2. **Ordenação Natural via Transformada de Schwartz:** Garante a ordem lógica independentemente da nomenclatura original.
3. **Renomeação com Zero-Padding Dinâmico:** Padroniza os nomes (`001.jpg`, `002.jpg`, ..., ajustando os dígitos ao total de páginas) para compatibilidade universal com qualquer leitor.
4. **Metadados `ComicInfo.xml`:** Gera opcionalmente na raiz do pacote o arquivo XML padrão com Título, Série, Volume, Número, Autor, Direção de Leitura (Ocidental LTR ou Mangá RTL) e índice de páginas.
5. **Empacotamento ZIP Nível Zero (`STORE`):** Empacota sem recomprimir imagens que já possuem compressão nativa, economizando CPU e acelerando a leitura posterior.

### 3. CBZ Reader (Leitura de Diretório Central + Janela Deslizante $[N-1 \dots N+3]$)
1. **Leitura Exclusiva do Diretório Central (*End of Central Directory*):** Ao abrir um `.cbz`, lê apenas os últimos 64 KB do arquivo para montar o índice mestre de páginas em poucos milissegundos, sem extrair o arquivo inteiro para o disco ou RAM.
2. **Gerenciador de Janela Deslizante ($[N-1 \dots N+3]$):**
   - Mantém em memória apenas o intervalo restrito ao redor da página atual $N$ (de $N-1$ até $N+3$).
   - **Limpeza Explícita de Memória:** Qualquer página que saia desse intervalo tem seu buffer/`ObjectURL` revogado imediatamente (`URL.revokeObjectURL`).
   - **Cancelamento de Tarefas (`AbortController`):** Se o usuário pular várias páginas de uma vez, extrações pendentes de janelas anteriores são abortadas imediatamente.
   - **Decodificação Assíncrona em Segundo Plano (`img.decode()`):** Converte os bytes extraídos em imagem e força a descompressão dos pixels para a memória de vídeo antes da exibição, garantindo viradas de página sem engasgos visuais.

---

## Estrutura do Projeto

```text
misericordia-cbz-reader-&-maker/
├── src/
│   ├── core/
│   │   ├── schwartzSort.ts         # Transformada de Schwartz (Key Extraction) + Zero-Padding
│   │   ├── zipCentralDirectory.ts  # Leitura do Diretório Central ZIP (Blob.slice) e Writer STORE (Nível 0)
│   │   ├── slidingWindowCache.ts   # Gerenciador de Janela Deslizante [N-1 .. N+3] + AbortController + img.decode()
│   │   ├── comicInfo.ts            # Gerador e Parser de ComicInfo.xml
│   │   ├── demoComicGenerator.ts   # Gerador de CBZ e pastas desordenadas de demonstração em tempo real
│   │   └── runtimeAdapter.ts       # Ponte de execução Híbrida (Tauri Rust IPC vs Web Browser)
│   ├── components/
│   │   ├── CbzReaderView.tsx       # Interface do Leitor + HUD de Telemetria da Janela Deslizante
│   │   └── CbzMakerView.tsx        # Interface do Criador + Tabela de Chaves de Schwartz
│   └── App.tsx
├── cli/
│   ├── src/main.rs                 # Binário nativo de Terminal para PC (proselytize info / meta / pack)
│   └── Cargo.toml
└── src-tauri/
    ├── src/
    │   ├── schwartz.rs             # Motor Rust da Transformada de Schwartz + Testes Unitários
    │   ├── cbz_engine.rs           # Motor Rust de Diretório Central ZIP, ZIP64 e Writer STORE
    │   ├── comic_info.rs           # Parser, Serializador e Editor In-Place de ComicInfo.xml
    │   └── lib.rs
    └── Cargo.toml
```

---

## Como Executar

### 1. Aplicação Web (Vercel / React + Vite)
```bash
npm install
npm run dev
```

### 2. Aplicação PC via Terminal (Proselytize CLI em Rust)
```bash
cd cli
cargo build --release

# Inspecionar Diretório Central e ComicInfo.xml de um CBZ:
./target/release/proselytize info ../meu_quadrinho.cbz

# Editar metadados ComicInfo.xml diretamente pelo terminal:
./target/release/proselytize meta ../meu_quadrinho.cbz --title "Romance Dawn" --series "One Piece" --writer "Eiichiro Oda" --manga

# Empacotar pasta de imagens com Transformada de Schwartz e Zero-Padding:
./target/release/proselytize pack ./pasta_imagens -o capitulo_01.cbz --title "Capítulo 1" --manga
```

### 3. Testes Unitários do Motor em Rust
```bash
cd src-tauri && cargo test
```
