import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Code2,
  Download,
  FileCode,
  FolderOpen,
  ImagePlus,
  Play,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import {
  formatZeroPaddedPageName,
  isValidImageEntry,
  schwartzNaturalSort,
  SchwartzSortKey,
} from '../core/schwartzSort';
import { buildComicInfoXml, ComicInfoMetadata } from '../core/comicInfo';
import { createStoreCbzBlob } from '../core/zipCentralDirectory';
import { generateDemoMessyFolder } from '../core/demoComicGenerator';

interface RawCandidateFile {
  id: string;
  originalName: string;
  byteSize: number;
  getBytes: () => Promise<Uint8Array>;
}

interface SortedMakerItem {
  candidate: RawCandidateFile;
  schwartzKey: SchwartzSortKey;
  targetZeroPaddedName: string;
  pageNumber: number;
}

interface CbzMakerViewProps {
  onOpenCreatedCbzInReader: (cbzFile: File) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const CbzMakerView: React.FC<CbzMakerViewProps> = ({
  onOpenCreatedCbzInReader,
}) => {
  const [rawCandidates, setRawCandidates] = useState<RawCandidateFile[]>([]);
  const [discardedCount, setDiscardedCount] = useState<number>(0);
  const [includeComicInfo, setIncludeComicInfo] = useState<boolean>(true);
  const [showXmlPreview, setShowXmlPreview] = useState<boolean>(false);
  const [outputArchiveName, setOutputArchiveName] = useState<string>(
    'manga_volume_01.cbz'
  );
  const [isBuilding, setIsBuilding] = useState<boolean>(false);
  const [lastBuildStats, setLastBuildStats] = useState<{
    fileSize: number;
    buildTimeMs: number;
    file: File;
  } | null>(null);

  const [meta, setMeta] = useState<ComicInfoMetadata>({
    title: 'Volume 01',
    series: 'Minha Série de Quadrinhos',
    number: '1',
    volume: '1',
    writer: '',
    summary: '',
    manga: 'No',
    languageISO: 'pt-BR',
    pageCount: 0,
  });

  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);

  // Executa a Transformada de Schwartz (Key Extraction) e calcula o Zero-Padding automaticamente
  const { sortedItems, sortDurationUs } = useMemo(() => {
    if (rawCandidates.length === 0) {
      return { sortedItems: [] as SortedMakerItem[], sortDurationUs: 0 };
    }

    const result = schwartzNaturalSort(
      rawCandidates,
      (item) => item.originalName
    );
    const total = result.indexed.length;

    const items: SortedMakerItem[] = result.indexed.map((entry, idx) => ({
      candidate: entry.item,
      schwartzKey: entry.key,
      targetZeroPaddedName: formatZeroPaddedPageName(
        idx,
        total,
        entry.item.originalName
      ),
      pageNumber: idx + 1,
    }));

    return {
      sortedItems: items,
      sortDurationUs: result.durationUs,
    };
  }, [rawCandidates]);

  const xmlPreviewText = useMemo(() => {
    return buildComicInfoXml(
      {
        ...meta,
        pageCount: sortedItems.length,
      },
      sortedItems.map((it, index) => ({
        index,
        byteSize: it.candidate.byteSize,
      }))
    );
  }, [meta, sortedItems]);

  const handleIngestFileList = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    const valid: RawCandidateFile[] = [];
    let ignored = 0;

    Array.from(fileList).forEach((file, idx) => {
      const relativeOrName =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
        file.name;

      if (isValidImageEntry(relativeOrName)) {
        valid.push({
          id: `${relativeOrName}-${file.size}-${idx}-${Date.now()}`,
          originalName: relativeOrName,
          byteSize: file.size,
          getBytes: async () => new Uint8Array(await file.arrayBuffer()),
        });
      } else {
        ignored++;
      }
    });

    setDiscardedCount((prev) => prev + ignored);
    setRawCandidates((prev) => [...prev, ...valid]);
    setLastBuildStats(null);
  };

  const handleLoadMessyDemoFolder = async () => {
    setIsBuilding(true);
    try {
      const demoFiles = await generateDemoMessyFolder();
      // Simula também 2 arquivos ocultos de sistema descartados (.DS_Store e Thumbs.db)
      setDiscardedCount(2);
      setRawCandidates(
        demoFiles.map((df, i) => ({
          id: `demo-${i}-${df.originalMessyName}`,
          originalName: df.originalMessyName,
          byteSize: df.data.byteLength,
          getBytes: async () => df.data,
        }))
      );
      setMeta({
        title: 'Crônicas da Janela Deslizante',
        series: 'Misericordia Engine Showcase',
        number: '01',
        volume: '1',
        writer: 'Misericordia Studio',
        summary:
          'Arquivos originalmente fora de ordem (capitulo_01_pagina_10.jpg antes de capitulo_01_pagina_2.jpg) ordenados com Transformada de Schwartz e renomeados com Zero-Padding.',
        manga: 'No',
        languageISO: 'pt-BR',
        pageCount: demoFiles.length,
      });
      setOutputArchiveName('Misericordia_Capitulo_01.cbz');
      setLastBuildStats(null);
    } finally {
      setIsBuilding(false);
    }
  };

  const handleBuildCbz = async (openInReaderAfter: boolean) => {
    if (sortedItems.length === 0) return;
    setIsBuilding(true);

    try {
      const t0 = performance.now();
      const entries: { archiveName: string; data: Uint8Array }[] = [];

      for (const item of sortedItems) {
        const bytes = await item.candidate.getBytes();
        entries.push({
          archiveName: item.targetZeroPaddedName,
          data: bytes,
        });
      }

      const xmlString = includeComicInfo ? xmlPreviewText : undefined;
      const cbzBlob = createStoreCbzBlob(entries, xmlString);

      const cleanName = outputArchiveName.trim().endsWith('.cbz')
        ? outputArchiveName.trim()
        : `${outputArchiveName.trim() || 'quadrinho'}.cbz`;

      const finalFile = new File([cbzBlob], cleanName, {
        type: 'application/vnd.comicbook+zip',
      });

      const buildTimeMs = Math.max(1, Math.round(performance.now() - t0));
      setLastBuildStats({
        fileSize: finalFile.size,
        buildTimeMs,
        file: finalFile,
      });

      if (openInReaderAfter) {
        onOpenCreatedCbzInReader(finalFile);
      } else {
        const url = URL.createObjectURL(finalFile);
        const a = document.createElement('a');
        a.href = url;
        a.download = cleanName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      }
    } finally {
      setIsBuilding(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Cabeçalho Explicativo do Pipeline do CBZ Maker */}
      <div className="rounded-2xl bg-zinc-900/80 border border-zinc-800 p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-medium">
            <Zap className="w-3.5 h-3.5" />
            Pipeline CBZ Maker • ZIP STORE (Nível 0) + Transformada de Schwartz
          </div>
          <h1 className="text-2xl font-bold text-zinc-100">
            Criador e Padronizador de Arquivos .CBZ
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Filtra imagens válidas (<code className="text-zinc-200">JPG, PNG, WebP</code>),
            descarta arquivos ocultos do sistema, aplica a{' '}
            <strong>Transformada de Schwartz (Key Extraction)</strong> para ordenar
            nomes sem zeros à esquerda, renomeia com{' '}
            <strong>Zero-Padding dinâmico</strong> (<code className="text-amber-300">001.jpg</code>)
            e empacota com <strong>ComicInfo.xml</strong> no modo{' '}
            <strong>STORE (sem recompressão)</strong>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Input de Pasta Completa */}
          <input
            ref={folderInputRef}
            type="file"
            multiple
            // @ts-expect-error webkitdirectory attribute for folder selection
            webkitdirectory=""
            directory=""
            className="hidden"
            onChange={(e) => {
              handleIngestFileList(e.target.files);
              e.target.value = '';
            }}
          />

          {/* Input de Imagens Avulsas */}
          <input
            ref={filesInputRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.webp,.gif,.avif"
            className="hidden"
            onChange={(e) => {
              handleIngestFileList(e.target.files);
              e.target.value = '';
            }}
          />

          <button
            onClick={() => folderInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs sm:text-sm transition cursor-pointer shadow-lg shadow-amber-500/15"
          >
            <FolderOpen className="w-4 h-4" />
            Selecionar Pasta de Imagens
          </button>

          <button
            onClick={() => filesInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-medium text-xs sm:text-sm border border-zinc-700 transition cursor-pointer"
          >
            <ImagePlus className="w-4 h-4 text-sky-400" />
            Adicionar Imagens
          </button>

          <button
            onClick={handleLoadMessyDemoFolder}
            disabled={isBuilding}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-amber-300 font-medium text-xs sm:text-sm border border-amber-500/30 transition cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            Carregar Pasta Teste (Nomes Desordenados)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Coluna Esquerda: Tabela de Ordenação de Schwartz & Renomeação Zero-Padding */}
        <div className="lg:col-span-7 space-y-4">
          <div className="rounded-2xl bg-zinc-900/90 border border-zinc-800 overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-bold text-sm text-zinc-100 flex items-center gap-2">
                  1. Ordenação Natural (Transformada de Schwartz) &amp; Zero-Padding
                </h2>
                <p className="text-xs text-zinc-400">
                  {sortedItems.length} páginas válidas prontas •{' '}
                  {discardedCount > 0 && (
                    <span className="text-rose-400">
                      {discardedCount} arquivo(s) oculto(s)/sistema descartado(s) •{' '}
                    </span>
                  )}
                  Tempo de Key Extraction + Sort:{' '}
                  <span className="font-mono text-emerald-400 font-semibold">
                    {sortDurationUs} µs
                  </span>
                </p>
              </div>

              {sortedItems.length > 0 && (
                <button
                  onClick={() => {
                    setRawCandidates([]);
                    setDiscardedCount(0);
                    setLastBuildStats(null);
                  }}
                  className="inline-flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Limpar Lista
                </button>
              )}
            </div>

            {sortedItems.length === 0 ? (
              <div className="p-12 text-center space-y-3">
                <p className="text-sm text-zinc-400">
                  Nenhuma imagem carregada ainda. Selecione uma pasta do seu computador
                  ou clique em{' '}
                  <strong className="text-amber-300">
                    &ldquo;Carregar Pasta Teste (Nomes Desordenados)&rdquo;
                  </strong>{' '}
                  para ver a Transformada de Schwartz ordenando arquivos sem zeros à esquerda.
                </p>
              </div>
            ) : (
              <div className="max-h-[460px] overflow-y-auto divide-y divide-zinc-800/70">
                <div className="grid grid-cols-12 px-4 py-2 bg-zinc-950/70 text-[11px] font-mono uppercase text-zinc-400">
                  <div className="col-span-5">Nome Original Bruto</div>
                  <div className="col-span-4">Chave de Schwartz [Texto, u64]</div>
                  <div className="col-span-3 text-right">Saída Padronizada</div>
                </div>

                {sortedItems.map((item) => (
                  <div
                    key={item.candidate.id}
                    className="grid grid-cols-12 items-center px-4 py-2.5 text-xs hover:bg-zinc-800/40 transition font-mono"
                  >
                    <div
                      className="col-span-5 truncate text-zinc-300 pr-2"
                      title={item.candidate.originalName}
                    >
                      {item.candidate.originalName}
                    </div>
                    <div
                      className="col-span-4 truncate text-sky-300 text-[11px] pr-2"
                      title={item.schwartzKey.formattedKey}
                    >
                      {item.schwartzKey.formattedKey}
                    </div>
                    <div className="col-span-3 flex items-center justify-end gap-1.5 text-emerald-400 font-semibold">
                      <ArrowRight className="w-3 h-3 text-zinc-500" />
                      {item.targetZeroPaddedName}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Coluna Direita: Metadados ComicInfo.xml & Empacotador ZIP STORE */}
        <div className="lg:col-span-5 space-y-6">
          <div className="rounded-2xl bg-zinc-900/90 border border-zinc-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeComicInfo}
                  onChange={(e) => setIncludeComicInfo(e.target.checked)}
                  className="rounded accent-amber-500 w-4 h-4"
                />
                <span className="font-bold text-sm text-zinc-100 flex items-center gap-1.5">
                  <FileCode className="w-4 h-4 text-amber-400" />
                  2. Gerar ComicInfo.xml na Raiz
                </span>
              </label>

              {includeComicInfo && (
                <button
                  onClick={() => setShowXmlPreview((p) => !p)}
                  className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 font-mono"
                >
                  <Code2 className="w-3.5 h-3.5" />
                  {showXmlPreview ? 'Ocultar XML' : 'Ver XML'}
                </button>
              )}
            </div>

            {includeComicInfo && (
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-zinc-400 mb-1">
                      Título do Capítulo/Edição
                    </label>
                    <input
                      type="text"
                      value={meta.title}
                      onChange={(e) =>
                        setMeta({ ...meta, title: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-400 mb-1">Série</label>
                    <input
                      type="text"
                      value={meta.series}
                      onChange={(e) =>
                        setMeta({ ...meta, series: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-zinc-400 mb-1">Volume</label>
                    <input
                      type="text"
                      value={meta.volume}
                      onChange={(e) =>
                        setMeta({ ...meta, volume: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-400 mb-1">Número</label>
                    <input
                      type="text"
                      value={meta.number}
                      onChange={(e) =>
                        setMeta({ ...meta, number: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-400 mb-1">
                      Direção Mangá
                    </label>
                    <select
                      value={meta.manga}
                      onChange={(e) =>
                        setMeta({
                          ...meta,
                          manga: e.target.value as 'No' | 'YesAndRightToLeft',
                        })
                      }
                      className="w-full px-2.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-amber-500 focus:outline-none"
                    >
                      <option value="No">Ocidental (LTR)</option>
                      <option value="YesAndRightToLeft">Mangá (RTL)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-zinc-400 mb-1">
                    Autor / Roteirista
                  </label>
                  <input
                    type="text"
                    value={meta.writer}
                    onChange={(e) =>
                      setMeta({ ...meta, writer: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-amber-500 focus:outline-none"
                  />
                </div>

                {showXmlPreview && (
                  <pre className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-amber-200 overflow-x-auto max-h-48">
                    {xmlPreviewText}
                  </pre>
                )}
              </div>
            )}
          </div>

          {/* Etapa Final: Empacotamento ZIP Nível 0 (STORE) */}
          <div className="rounded-2xl bg-zinc-900/90 border border-zinc-800 p-5 space-y-4">
            <h3 className="font-bold text-sm text-zinc-100">
              3. Empacotamento ZIP Nível Zero (STORE)
            </h3>

            <div className="text-xs">
              <label className="block text-zinc-400 mb-1">
                Nome do Arquivo Final (.cbz)
              </label>
              <input
                type="text"
                value={outputArchiveName}
                onChange={(e) => setOutputArchiveName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 font-mono focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => handleBuildCbz(false)}
                disabled={sortedItems.length === 0 || isBuilding}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-semibold text-xs sm:text-sm transition cursor-pointer"
              >
                <Download className="w-4 h-4" />
                {isBuilding ? 'Empacotando STORE...' : 'Baixar Arquivo .CBZ'}
              </button>

              <button
                onClick={() => handleBuildCbz(true)}
                disabled={sortedItems.length === 0 || isBuilding}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-40 text-emerald-200 border border-emerald-500/40 font-semibold text-xs sm:text-sm transition cursor-pointer"
              >
                <Play className="w-4 h-4" />
                Gerar &amp; Abrir no Leitor
              </button>
            </div>

            {lastBuildStats && (
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    CBZ gerado em <strong>{lastBuildStats.buildTimeMs} ms</strong> (
                    {formatBytes(lastBuildStats.fileSize)}) no modo STORE!
                  </span>
                </div>
                <button
                  onClick={() => onOpenCreatedCbzInReader(lastBuildStats.file)}
                  className="underline font-semibold hover:text-white ml-2"
                >
                  Ler agora
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
