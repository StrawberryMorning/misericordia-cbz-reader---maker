import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  Code2,
  Download,
  FileArchive,
  FileCode,
  Layers,
  Sparkles,
  Terminal,
  Upload,
} from 'lucide-react';
import {
  buildComicInfoXml,
  ComicInfoMetadata,
  ComicPageType,
  createEmptyComicInfo,
  PageMetaEntry,
} from '../core/comicInfo';
import {
  CbzIndexSummary,
  readCbzCentralDirectory,
  repackCbzWithUpdatedComicInfo,
} from '../core/zipCentralDirectory';
import { generateDemoCbzFile } from '../core/demoComicGenerator';

interface MetadataStudioViewProps {
  externalCbzFile: File | null;
  onOpenUpdatedCbzInReader: (file: File) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const MetadataStudioView: React.FC<MetadataStudioViewProps> = ({
  externalCbzFile,
  onOpenUpdatedCbzInReader,
}) => {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [indexSummary, setIndexSummary] = useState<CbzIndexSummary | null>(null);
  const [meta, setMeta] = useState<ComicInfoMetadata>(createEmptyComicInfo(0));
  const [pageTypes, setPageTypes] = useState<Record<number, ComicPageType>>({});
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [savedFile, setSavedFile] = useState<File | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadCbzForMetadata = useCallback(async (file: File) => {
    setIsProcessing(true);
    setStatusMessage(null);
    setSavedFile(null);

    try {
      const summary = await readCbzCentralDirectory(file, file.name);
      setSourceFile(file);
      setIndexSummary(summary);

      const base = createEmptyComicInfo(summary.pages.length);
      const parsed = summary.comicInfo || {};

      setMeta({
        ...base,
        title: parsed.title || file.name.replace(/\.cbz$/i, ''),
        series: parsed.series || '',
        number: parsed.number || '1',
        volume: parsed.volume || '1',
        writer: parsed.writer || '',
        penciller: parsed.penciller || '',
        inker: parsed.inker || '',
        colorist: parsed.colorist || '',
        letterer: parsed.letterer || '',
        coverArtist: parsed.coverArtist || '',
        publisher: parsed.publisher || '',
        genre: parsed.genre || '',
        tags: parsed.tags || '',
        ageRating: parsed.ageRating || 'Everyone',
        year: parsed.year || String(new Date().getFullYear()),
        month: parsed.month || '',
        day: parsed.day || '',
        web: parsed.web || '',
        summary: parsed.summary || '',
        manga: parsed.manga || 'No',
        languageISO: parsed.languageISO || 'pt-BR',
        pageCount: summary.pages.length,
      });

      const initialTypes: Record<number, ComicPageType> = { 0: 'FrontCover' };
      if (summary.pages.length > 1) {
        initialTypes[summary.pages.length - 1] = 'BackCover';
      }
      setPageTypes(initialTypes);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  useEffect(() => {
    if (externalCbzFile) {
      loadCbzForMetadata(externalCbzFile);
    }
  }, [externalCbzFile, loadCbzForMetadata]);

  const handleLoadDemo = async () => {
    setIsProcessing(true);
    try {
      const demo = await generateDemoCbzFile();
      await loadCbzForMetadata(demo);
    } finally {
      setIsProcessing(false);
    }
  };

  const pageMetaEntries: PageMetaEntry[] = useMemo(() => {
    if (!indexSummary) return [];
    return indexSummary.pages.map((p, idx) => {
      const pType = pageTypes[idx] || (idx === 0 ? 'FrontCover' : 'Story');
      return {
        index: idx,
        byteSize: p.uncompressedSize || p.compressedSize,
        type: pType,
        doublePage: pType === 'DoublePage',
      };
    });
  }, [indexSummary, pageTypes]);

  const generatedXml = useMemo(() => {
    return buildComicInfoXml(
      {
        ...meta,
        pageCount: indexSummary ? indexSummary.pages.length : meta.pageCount,
      },
      pageMetaEntries
    );
  }, [meta, indexSummary, pageMetaEntries]);

  // Gera o comando equivalente para o Terminal CLI em Rust
  const cliCommandPreview = useMemo(() => {
    const fileName = sourceFile?.name || 'capitulo_01.cbz';
    const args: string[] = [`proselytize meta "${fileName}"`];
    if (meta.title.trim()) args.push(`--title "${meta.title.trim()}"`);
    if (meta.series.trim()) args.push(`--series "${meta.series.trim()}"`);
    if (meta.volume.trim()) args.push(`--volume "${meta.volume.trim()}"`);
    if (meta.number.trim()) args.push(`--number "${meta.number.trim()}"`);
    if (meta.writer.trim()) args.push(`--writer "${meta.writer.trim()}"`);
    if (meta.penciller?.trim()) args.push(`--penciller "${meta.penciller.trim()}"`);
    if (meta.publisher?.trim()) args.push(`--publisher "${meta.publisher.trim()}"`);
    if (meta.genre?.trim()) args.push(`--genre "${meta.genre.trim()}"`);
    if (meta.year?.trim()) args.push(`--year "${meta.year.trim()}"`);
    if (meta.manga === 'YesAndRightToLeft') args.push('--manga');
    return args.join(' \\\n  ');
  }, [sourceFile, meta]);

  const handleSaveUpdatedCbz = async (openInReader: boolean) => {
    if (!sourceFile || !indexSummary) return;
    setIsProcessing(true);
    setStatusMessage('Injetando ComicInfo.xml atualizado no pacote CBZ...');

    try {
      const updatedBlob = await repackCbzWithUpdatedComicInfo(
        sourceFile,
        indexSummary.pages,
        generatedXml,
        (curr, total) => {
          setStatusMessage(
            `Preservando página ${curr}/${total} no modo STORE...`
          );
        }
      );

      const outFile = new File([updatedBlob], sourceFile.name, {
        type: 'application/vnd.comicbook+zip',
      });
      setSavedFile(outFile);

      if (openInReader) {
        onOpenUpdatedCbzInReader(outFile);
      } else {
        const url = URL.createObjectURL(outFile);
        const a = document.createElement('a');
        a.href = url;
        a.download = outFile.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      }
    } finally {
      setIsProcessing(false);
      setStatusMessage(null);
    }
  };

  const handleDownloadXmlOnly = () => {
    const blob = new Blob([generatedXml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ComicInfo.xml';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <input
        ref={fileInputRef}
        type="file"
        accept=".cbz,.zip,application/vnd.comicbook+zip,application/zip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadCbzForMetadata(f);
          e.target.value = '';
        }}
      />

      {/* Banner do Metadata Studio */}
      <div className="rounded-2xl bg-zinc-900/80 border border-zinc-800 p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-medium">
            <FileCode className="w-3.5 h-3.5" />
            Proselytize Metadata Studio • Manipulação Avançada de ComicInfo.xml
          </div>
          <h1 className="text-2xl font-bold text-zinc-100">
            Inspeção e Edição de Metadados (.CBZ &amp; CLI)
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Extraia o <code className="text-rose-300">ComicInfo.xml</code> diretamente
            do Diretório Central sem descompactar o arquivo, edite créditos completos
            (roteirista, desenhista, editora, gênero, páginas duplas) e regrave o{' '}
            <code className="text-zinc-200">.cbz</code> preservando os bytes originais
            das imagens.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-semibold text-xs sm:text-sm transition cursor-pointer shadow-lg shadow-rose-500/20"
          >
            <Upload className="w-4 h-4" />
            Abrir .CBZ para Editar Metadados
          </button>

          <button
            onClick={handleLoadDemo}
            disabled={isProcessing}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-amber-300 font-medium text-xs sm:text-sm border border-amber-500/30 transition cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            Carregar CBZ Demo
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="rounded-xl bg-sky-500/10 border border-sky-500/30 px-4 py-3 flex items-center gap-3 text-xs text-sky-200 font-mono">
          <div className="w-4 h-4 rounded-full border-2 border-sky-400 border-t-transparent animate-spin shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Coluna Esquerda: Formulário Completo de Metadados + Classificador de Páginas */}
        <div className="lg:col-span-7 space-y-6">
          <div className="rounded-2xl bg-zinc-900/90 border border-zinc-800 p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h2 className="font-bold text-sm text-zinc-100">
                  1. Dados da Obra, Série &amp; Publicação
                </h2>
                <p className="text-xs text-zinc-400">
                  {indexSummary
                    ? `Arquivo ativo: ${indexSummary.fileName} (${formatBytes(
                        indexSummary.fileSize
                      )} • ${indexSummary.pages.length} páginas)`
                    : 'Você pode preencher os metadados abaixo ou abrir um .CBZ existente'}
                </p>
              </div>
              {indexSummary && (
                <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  Parse Central: {indexSummary.centralDirParseTimeMs} ms
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-zinc-400 mb-1">Título da Edição / Capítulo</label>
                <input
                  type="text"
                  value={meta.title}
                  onChange={(e) => setMeta({ ...meta, title: e.target.value })}
                  placeholder="Ex: Romance Dawn"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">Série / Coleção</label>
                <input
                  type="text"
                  value={meta.series}
                  onChange={(e) => setMeta({ ...meta, series: e.target.value })}
                  placeholder="Ex: One Piece"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-rose-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="block text-zinc-400 mb-1">Volume</label>
                <input
                  type="text"
                  value={meta.volume}
                  onChange={(e) => setMeta({ ...meta, volume: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-rose-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-zinc-400 mb-1">Número (#)</label>
                <input
                  type="text"
                  value={meta.number}
                  onChange={(e) => setMeta({ ...meta, number: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-rose-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-zinc-400 mb-1">Ano</label>
                <input
                  type="text"
                  value={meta.year || ''}
                  onChange={(e) => setMeta({ ...meta, year: e.target.value })}
                  placeholder="2026"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-rose-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-zinc-400 mb-1">Idioma (ISO)</label>
                <input
                  type="text"
                  value={meta.languageISO}
                  onChange={(e) =>
                    setMeta({ ...meta, languageISO: e.target.value })
                  }
                  placeholder="pt-BR"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-rose-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Créditos Criativos */}
            <div className="pt-2 border-t border-zinc-800/80">
              <h3 className="font-semibold text-xs text-zinc-300 mb-3">
                2. Equipe Criativa &amp; Editora
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-zinc-400 mb-1">
                    Roteirista (Writer)
                  </label>
                  <input
                    type="text"
                    value={meta.writer}
                    onChange={(e) =>
                      setMeta({ ...meta, writer: e.target.value })
                    }
                    placeholder="Ex: Eiichiro Oda"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-rose-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 mb-1">
                    Desenhista (Penciller)
                  </label>
                  <input
                    type="text"
                    value={meta.penciller || ''}
                    onChange={(e) =>
                      setMeta({ ...meta, penciller: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-rose-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 mb-1">
                    Editora (Publisher)
                  </label>
                  <input
                    type="text"
                    value={meta.publisher || ''}
                    onChange={(e) =>
                      setMeta({ ...meta, publisher: e.target.value })
                    }
                    placeholder="Ex: Manhã de Morango S/A"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-rose-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Gênero, Classificação e Direção de Leitura */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-2 border-t border-zinc-800/80">
              <div>
                <label className="block text-zinc-400 mb-1">
                  Gêneros (separados por vírgula)
                </label>
                <input
                  type="text"
                  value={meta.genre || ''}
                  onChange={(e) => setMeta({ ...meta, genre: e.target.value })}
                  placeholder="Ação, Aventura, Fantasia"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">
                  Direção de Leitura
                </label>
                <select
                  value={meta.manga}
                  onChange={(e) =>
                    setMeta({
                      ...meta,
                      manga: e.target.value as 'No' | 'YesAndRightToLeft',
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-rose-500 focus:outline-none"
                >
                  <option value="No">Ocidental (Esquerda → Direita)</option>
                  <option value="YesAndRightToLeft">
                    Mangá RTL (Direita ← Esquerda)
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">
                  Classificação Etária
                </label>
                <select
                  value={meta.ageRating || 'Everyone'}
                  onChange={(e) =>
                    setMeta({ ...meta, ageRating: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-rose-500 focus:outline-none"
                >
                  <option value="Everyone">Livre (Everyone)</option>
                  <option value="Teen">Adolescente (Teen 13+)</option>
                  <option value="Mature 17+">Adulto (Mature 17+)</option>
                </select>
              </div>
            </div>

            <div className="text-xs">
              <label className="block text-zinc-400 mb-1">Sinopse (Summary)</label>
              <textarea
                rows={3}
                value={meta.summary}
                onChange={(e) => setMeta({ ...meta, summary: e.target.value })}
                placeholder="Descrição da edição ou resumo do capítulo..."
                className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-rose-500 focus:outline-none"
              />
            </div>

            {/* Botões de Ação */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                onClick={() => handleSaveUpdatedCbz(false)}
                disabled={!sourceFile || isProcessing}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-rose-500 hover:bg-rose-400 disabled:opacity-40 text-white font-semibold text-xs sm:text-sm transition cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Salvar e Baixar .CBZ Atualizado
              </button>

              <button
                onClick={() => handleSaveUpdatedCbz(true)}
                disabled={!sourceFile || isProcessing}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-40 text-emerald-200 border border-emerald-500/40 font-semibold text-xs sm:text-sm transition cursor-pointer"
              >
                <BookOpen className="w-4 h-4" />
                Aplicar &amp; Abrir no Reader
              </button>

              <button
                onClick={handleDownloadXmlOnly}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-xs font-medium transition cursor-pointer"
              >
                <FileCode className="w-4 h-4 text-amber-400" />
                Baixar .XML
              </button>
            </div>

            {savedFile && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Metadados gravados com sucesso em{' '}
                  <strong>{savedFile.name}</strong>!
                </span>
                <button
                  onClick={() => onOpenUpdatedCbzInReader(savedFile)}
                  className="underline font-semibold hover:text-white"
                >
                  Ler no Reader
                </button>
              </div>
            )}
          </div>

          {/* Classificador de Tipos de Página (<Pages>) */}
          {indexSummary && (
            <div className="rounded-2xl bg-zinc-900/90 border border-zinc-800 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
                <h3 className="font-bold text-xs sm:text-sm text-zinc-100 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-sky-400" />
                  3. Metadados Individuais por Página (&lt;Page Type=&quot;...&quot; /&gt;)
                </h3>
                <span className="text-xs font-mono text-zinc-400">
                  {indexSummary.pages.length} páginas mapeadas
                </span>
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-zinc-800/70">
                {indexSummary.pages.map((p, idx) => (
                  <div
                    key={p.fileName}
                    className="px-4 py-2 flex items-center justify-between text-xs font-mono hover:bg-zinc-800/40"
                  >
                    <div className="truncate pr-3 text-zinc-300">
                      <span className="text-zinc-500 mr-2">#{idx + 1}</span>
                      {p.fileName}{' '}
                      <span className="text-zinc-500">
                        ({formatBytes(p.uncompressedSize || p.compressedSize)})
                      </span>
                    </div>
                    <select
                      value={
                        pageTypes[idx] || (idx === 0 ? 'FrontCover' : 'Story')
                      }
                      onChange={(e) =>
                        setPageTypes({
                          ...pageTypes,
                          [idx]: e.target.value as ComicPageType,
                        })
                      }
                      className="px-2 py-1 rounded bg-zinc-950 border border-zinc-800 text-amber-300 text-[11px]"
                    >
                      <option value="FrontCover">FrontCover (Capa)</option>
                      <option value="InnerCover">InnerCover (Capa Interna)</option>
                      <option value="Story">Story (Página Normal)</option>
                      <option value="DoublePage">DoublePage (Página Dupla)</option>
                      <option value="Advertisement">Advertisement (Anúncio)</option>
                      <option value="BackCover">BackCover (Contracapa)</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Coluna Direita: Preview do XML ao Vivo + Gerador de Comando CLI Rust */}
        <div className="lg:col-span-5 space-y-6">
          {/* Equivalente no Terminal PC (Proselytize CLI) */}
          <div className="rounded-2xl bg-zinc-900/90 border border-zinc-800 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-zinc-100 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                Comando Equivalente no PC (Terminal CLI)
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                cli/ Cargo Binary
              </span>
            </div>
            <p className="text-xs text-zinc-400">
              Para executar exatamente esta edição de metadados pelo terminal no PC usando
              o binário nativo em Rust:
            </p>
            <pre className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-emerald-300 overflow-x-auto leading-relaxed">
              {cliCommandPreview}
            </pre>
            <div className="text-[11px] text-zinc-400 font-mono space-y-1 pt-1">
              <div>
                • Inspecionar CBZ:{' '}
                <code className="text-zinc-200">
                  proselytize info &quot;{sourceFile?.name || 'arquivo.cbz'}&quot;
                </code>
              </div>
              <div>
                • Empacotar pasta:{' '}
                <code className="text-zinc-200">
                  proselytize pack ./pasta -o capitulo.cbz
                </code>
              </div>
            </div>
          </div>

          {/* Preview XML em Tempo Real */}
          <div className="rounded-2xl bg-zinc-900/90 border border-zinc-800 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-zinc-100 flex items-center gap-2">
                <Code2 className="w-4 h-4 text-amber-400" />
                ComicInfo.xml Gerado em Tempo Real
              </h3>
              <span className="text-[11px] font-mono text-zinc-400">
                {formatBytes(new Blob([generatedXml]).size)}
              </span>
            </div>
            <pre className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-amber-200/90 overflow-x-auto max-h-[420px] leading-relaxed">
              {generatedXml}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
