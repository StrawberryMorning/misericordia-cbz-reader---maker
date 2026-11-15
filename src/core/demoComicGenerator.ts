import { buildComicInfoXml, ComicInfoMetadata } from './comicInfo';
import { formatZeroPaddedPageName, schwartzNaturalSort } from './schwartzSort';
import { createStoreCbzBlob } from './zipCentralDirectory';

export interface DemoRawImageFile {
  originalMessyName: string;
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Renderiza uma página de mangá/quadrinho estilizada em Canvas e exporta como PNG/JPEG bytes.
 */
async function renderComicPageToBytes(
  pageNumber: number,
  totalPages: number,
  messyFilename: string,
  subtitle: string
): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 1300;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new Uint8Array();

  // Fundo escuro com gradiente sutil por página
  const hue = (pageNumber * 28) % 360;
  const grad = ctx.createLinearGradient(0, 0, 900, 1300);
  grad.addColorStop(0, `hsl(${hue}, 35%, 10%)`);
  grad.addColorStop(1, `hsl(${(hue + 40) % 360}, 45%, 6%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 900, 1300);

  // Moldura estilo prancha de mangá
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 5;
  ctx.strokeRect(36, 36, 828, 1228);

  // Painéis internos de quadrinho
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 3;
  // Painel superior
  ctx.strokeRect(64, 150, 772, 340);
  // Dois painéis médios
  ctx.strokeRect(64, 514, 374, 380);
  ctx.strokeRect(462, 514, 374, 380);
  // Painel inferior
  ctx.strokeRect(64, 918, 772, 260);

  // Linhas de velocidade no painel superior
  ctx.save();
  ctx.strokeStyle = `hsla(${hue}, 80%, 60%, 0.16)`;
  ctx.lineWidth = 2;
  for (let i = 0; i < 28; i++) {
    ctx.beginPath();
    ctx.moveTo(450, 320);
    const angle = (i / 28) * Math.PI * 2;
    ctx.lineTo(450 + Math.cos(angle) * 420, 320 + Math.sin(angle) * 200);
    ctx.stroke();
  }
  ctx.restore();

  // Cabeçalho
  ctx.fillStyle = '#fbbf24';
  ctx.font = 'bold 24px monospace';
  ctx.fillText('MISERICORDIA CBZ ENGINE // SCHWARTZIAN + SLIDING WINDOW', 64, 92);

  ctx.fillStyle = '#a1a1aa';
  ctx.font = '18px monospace';
  ctx.fillText(`Arquivo Original Bruto: "${messyFilename}"`, 64, 126);

  // Número gigante da página no painel principal
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 148px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    `PÁGINA ${String(pageNumber).padStart(2, '0')}`,
    450,
    365
  );

  // Texto explicativo nos painéis médios
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fde68a';
  ctx.font = 'bold 23px sans-serif';
  ctx.fillText('Transformada de Schwartz', 90, 565);

  ctx.fillStyle = '#d4d4d8';
  ctx.font = '18px monospace';
  ctx.fillText('1. Key Extraction O(N)', 90, 615);
  ctx.fillText('2. Tupla [Texto, u64]', 90, 650);
  ctx.fillText('3. Zero Regex Repetido', 90, 685);
  ctx.fillText(`-> Ordem Real #${pageNumber}`, 90, 740);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 23px sans-serif';
  ctx.fillText('Janela Deslizante [N-1..N+3]', 488, 565);

  ctx.fillStyle = '#d4d4d8';
  ctx.font = '18px monospace';
  const winStart = Math.max(1, pageNumber - 1);
  const winEnd = Math.min(totalPages, pageNumber + 3);
  ctx.fillText(`Janela Ativa: [${winStart} .. ${winEnd}]`, 488, 615);
  ctx.fillText('Fora da janela: Revogado!', 488, 650);
  ctx.fillText('Decodificação: img.decode()', 488, 685);
  ctx.fillText('Compressão ZIP: STORE (0)', 488, 740);

  // Painel inferior com narrativa
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText(subtitle, 96, 985);

  ctx.fillStyle = '#a1a1aa';
  ctx.font = '20px sans-serif';
  ctx.fillText(
    'Use as setas do teclado (← / →), clique nas bordas da imagem ou arraste a barra inferior.',
    96,
    1040
  );
  ctx.fillText(
    `Página ${pageNumber} de ${totalPages} • Leitura seletiva via Central Directory`,
    96,
    1100
  );

  const blob: Blob = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b || new Blob()), 'image/jpeg', 0.88)
  );
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Gera uma lista de arquivos brutos propositalmente fora de ordem lexicográfica
 * (ex: scan_10.jpg antes de scan_2.jpg) para demonstrar a Transformada de Schwartz no Maker.
 */
export async function generateDemoMessyFolder(): Promise<DemoRawImageFile[]> {
  const messyDefinitions = [
    { page: 10, name: 'capitulo_01_pagina_10.jpg', sub: 'Clímax: O salto para a página 10 na ordem certa!' },
    { page: 1, name: 'capitulo_01_pagina_1_capa.jpg', sub: 'Abertura: Mesmo sem zero à esquerda, esta é a Página 1.' },
    { page: 2, name: 'capitulo_01_pagina_2.jpg', sub: 'Página 2: Em ASCII viria depois da 10, mas Schwartz corrige!' },
    { page: 12, name: 'capitulo_01_pagina_12_fim.jpg', sub: 'Desfecho do Volume 01: Memória limpa e controlada.' },
    { page: 3, name: 'capitulo_01_pagina_3.jpg', sub: 'Página 3: Pré-carregada em segundo plano com image.decode().' },
    { page: 4, name: 'capitulo_01_pagina_4.jpg', sub: 'Página 4: A página 1 e 2 já saíram da janela e foram liberadas!' },
    { page: 11, name: 'capitulo_01_pagina_11.jpg', sub: 'Penúltima página: O índice central do ZIP ocupa poucos bytes.' },
    { page: 5, name: 'capitulo_01_pagina_5.jpg', sub: 'Página 5: Zero engasgos visuais na transição de quadros.' },
    { page: 6, name: 'capitulo_01_pagina_6.jpg', sub: 'Página 6: Experimente alternar entre Modo Ocidental e Mangá (RTL).' },
    { page: 7, name: 'capitulo_01_pagina_7.jpg', sub: 'Página 7: Experimente pular rápido para ver o AbortController.' },
    { page: 8, name: 'capitulo_01_pagina_8.jpg', sub: 'Página 8: Empacotado no modo STORE (Nível 0 - Sem recompressão).' },
    { page: 9, name: 'capitulo_01_pagina_9.jpg', sub: 'Página 9: Preparando a chegada na página 10!' },
  ];

  const total = messyDefinitions.length;
  const results: DemoRawImageFile[] = [];

  for (const def of messyDefinitions) {
    const bytes = await renderComicPageToBytes(def.page, total, def.name, def.sub);
    results.push({
      originalMessyName: def.name,
      data: bytes,
      width: 900,
      height: 1300,
    });
  }

  return results;
}

/**
 * Constrói um arquivo .cbz completo de demonstração em memória (usando o próprio pipeline do CBZ Maker)
 * para abrir imediatamente no CBZ Reader.
 */
export async function generateDemoCbzFile(): Promise<File> {
  const rawMessy = await generateDemoMessyFolder();

  const { sorted } = schwartzNaturalSort(
    rawMessy,
    (item) => item.originalMessyName
  );

  const renamedEntries = sorted.map((item, idx) => ({
    archiveName: formatZeroPaddedPageName(
      idx,
      sorted.length,
      item.originalMessyName
    ),
    data: item.data,
  }));

  const meta: ComicInfoMetadata = {
    title: 'Crônicas da Janela Deslizante',
    series: 'Misericordia Engine Showcase',
    number: '01',
    volume: '1',
    writer: 'Misericordia Studio (Rust + Tauri + React)',
    summary:
      'Volume demonstrativo gerado em tempo real com Transformada de Schwartz (Key Extraction), renomeação Zero-Padding e empacotamento ZIP STORE (Nível 0).',
    manga: 'No',
    languageISO: 'pt-BR',
    pageCount: renamedEntries.length,
  };

  const xml = buildComicInfoXml(
    meta,
    renamedEntries.map((e, index) => ({
      index,
      byteSize: e.data.byteLength,
    }))
  );

  const cbzBlob = createStoreCbzBlob(renamedEntries, xml);
  return new File([cbzBlob], 'Misericordia_Demo_Vol01.cbz', {
    type: 'application/vnd.comicbook+zip',
  });
}
