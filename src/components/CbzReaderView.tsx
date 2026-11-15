import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FileArchive,
  FolderPlus,
  Info,
  Layers,
  Maximize2,
  Minimize2,
  Repeat,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  CbzIndexSummary,
  readCbzCentralDirectory,
} from '../core/zipCentralDirectory';
import {
  SlidingWindowCacheManager,
  SlidingWindowSnapshot,
} from '../core/slidingWindowCache';
import { generateDemoCbzFile } from '../core/demoComicGenerator';

export type FitMode = 'fit-height' | 'fit-width' | 'original';
export type ReadingDirection = 'ltr' | 'rtl';

interface CbzReaderViewProps {
  externalCbzFile: File | null;
  onSwitchToMaker: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const CbzReaderView: React.FC<CbzReaderViewProps> = ({
  externalCbzFile,
  onSwitchToMaker,
}) => {
  const [indexSummary, setIndexSummary] = useState<CbzIndexSummary | null>(null);
  const [snapshot, setSnapshot] = useState<SlidingWindowSnapshot | null>(null);
  const [fitMode, setFitMode] = useState<FitMode>('fit-height');
  const [direction, setDirection] = useState<ReadingDirection>('ltr');
  const [showHud, setShowHud] = useState<boolean>(false); // Padrão mais discreto
  const [showMetaModal, setShowMetaModal] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isLoadingFile, setIsLoadingFile] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);

  // Estados de Zoom & Pan
  const [zoomLevel, setZoomLevel] = useState<number>(1); // 1 = 100%, 3 = 300%
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1);
  const lastTapTimeRef = useRef<number>(0);

  const managerRef = useRef<SlidingWindowCacheManager | null>(null);
  const readerContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Fecha o quadrinho, libera a memória e retorna à tela inicial
  const handleCloseComic = useCallback(() => {
    if (managerRef.current) {
      managerRef.current.dispose();
      managerRef.current = null;
    }
    setIndexSummary(null);
    setSnapshot(null);
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  const resetZoom = useCallback(() => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  const openCbzBlob = useCallback(async (file: File) => {
    setIsLoadingFile(true);
    setErrorMsg(null);
    resetZoom();

    if (managerRef.current) {
      managerRef.current.dispose();
      managerRef.current = null;
    }

    try {
      const summary = await readCbzCentralDirectory(file, file.name);
      if (summary.pages.length === 0) {
        throw new Error(
          'Nenhuma imagem válida (.jpg, .png, .webp) foi encontrada no Diretório Central deste arquivo .cbz.'
        );
      }

      setIndexSummary(summary);

      if (summary.comicInfo?.manga === 'YesAndRightToLeft') {
        setDirection('rtl');
      } else {
        setDirection('ltr');
      }

      const manager = SlidingWindowCacheManager.fromFileOrBlob(
        file,
        summary.pages,
        (nextSnap) => {
          setSnapshot(nextSnap);
        }
      );

      managerRef.current = manager;
      manager.navigateTo(0);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Erro desconhecido ao abrir o arquivo CBZ.'
      );
      setIndexSummary(null);
      setSnapshot(null);
    } finally {
      setIsLoadingFile(false);
    }
  }, [resetZoom]);

  useEffect(() => {
    if (externalCbzFile) {
      openCbzBlob(externalCbzFile);
    }
  }, [externalCbzFile, openCbzBlob]);

  useEffect(() => {
    return () => {
      if (managerRef.current) {
        managerRef.current.dispose();
      }
    };
  }, []);

  const handleLoadDemo = async () => {
    setIsLoadingFile(true);
    try {
      const demoFile = await generateDemoCbzFile();
      await openCbzBlob(demoFile);
    } finally {
      setIsLoadingFile(false);
    }
  };

  const goToPage = useCallback((pageIdx: number) => {
    if (!managerRef.current) return;
    resetZoom();
    managerRef.current.navigateTo(pageIdx);
  }, [resetZoom]);

  const stepForward = useCallback(() => {
    if (!snapshot) return;
    goToPage(snapshot.currentPage + 1);
  }, [snapshot, goToPage]);

  const stepBackward = useCallback(() => {
    if (!snapshot) return;
    goToPage(snapshot.currentPage - 1);
  }, [snapshot, goToPage]);

  const handleLeftEdgeAction = useCallback(() => {
    if (zoomLevel > 1.05) return; // Se estiver com zoom, não vira página ao clicar na borda
    if (direction === 'ltr') {
      stepBackward();
    } else {
      stepForward();
    }
  }, [direction, stepBackward, stepForward, zoomLevel]);

  const handleRightEdgeAction = useCallback(() => {
    if (zoomLevel > 1.05) return;
    if (direction === 'ltr') {
      stepForward();
    } else {
      stepBackward();
    }
  }, [direction, stepForward, stepBackward, zoomLevel]);

  const toggleFullscreen = useCallback(() => {
    if (!readerContainerRef.current) return;
    if (!document.fullscreenElement) {
      readerContainerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  }, []);

  // Atalhos de teclado (incluindo Esc para fechar)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!snapshot) return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        if (zoomLevel > 1) {
          resetZoom();
        } else {
          handleCloseComic();
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        handleLeftEdgeAction();
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        handleRightEdgeAction();
      } else if (e.key === ' ') {
        e.preventDefault();
        if (e.shiftKey) {
          stepBackward();
        } else {
          stepForward();
        }
      } else if (e.key === 'Home') {
        e.preventDefault();
        goToPage(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        goToPage(snapshot.totalPages - 1);
      } else if (e.key === 'm' || e.key === 'M') {
        setDirection((prev) => (prev === 'ltr' ? 'rtl' : 'ltr'));
      } else if (e.key === 'v' || e.key === 'V') {
        setFitMode((prev) =>
          prev === 'fit-height'
            ? 'fit-width'
            : prev === 'fit-width'
            ? 'original'
            : 'fit-height'
        );
      } else if (e.key === 'i' || e.key === 'I') {
        setShowHud((prev) => !prev);
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoomLevel((z) => Math.min(3.5, Number((z + 0.25).toFixed(2))));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setZoomLevel((z) => {
          const next = Math.max(1, Number((z - 0.25).toFixed(2)));
          if (next === 1) setPanOffset({ x: 0, y: 0 });
          return next;
        });
      } else if (e.key === '0') {
        e.preventDefault();
        resetZoom();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    snapshot,
    zoomLevel,
    handleCloseComic,
    resetZoom,
    handleLeftEdgeAction,
    handleRightEdgeAction,
    stepForward,
    stepBackward,
    goToPage,
    toggleFullscreen,
  ]);

  // Interação de Zoom via Scroll do Mouse (Wheel) no PC
  const handleWheelZoom = useCallback((e: React.WheelEvent) => {
    // Zoom com Ctrl+Scroll ou se já estiver ampliado
    if (e.ctrlKey || e.metaKey || zoomLevel > 1) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      setZoomLevel((prev) => {
        const next = Math.max(1, Math.min(3.5, Number((prev + delta).toFixed(2))));
        if (next === 1) {
          setPanOffset({ x: 0, y: 0 });
        }
        return next;
      });
    }
  }, [zoomLevel]);

  // Arrastar Imagem Ampliada com o Mouse (Pan)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoomLevel <= 1) return;
    setIsPanning(true);
    panStartRef.current = {
      x: e.clientX - panOffset.x,
      y: e.clientY - panOffset.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning || zoomLevel <= 1) return;
    setPanOffset({
      x: e.clientX - panStartRef.current.x,
      y: e.clientY - panStartRef.current.y,
    });
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  // Touch Events para Mobile: Gesto de Pinça (Pinch-to-Zoom) + Toque Duplo
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Inicia pinça
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDistRef.current = Math.hypot(dx, dy);
      pinchStartZoomRef.current = zoomLevel;
    } else if (e.touches.length === 1) {
      // Verifica toque duplo rápido para resetar/alternar zoom
      const now = performance.now();
      if (now - lastTapTimeRef.current < 300) {
        if (zoomLevel > 1) {
          resetZoom();
        } else {
          setZoomLevel(2.0);
        }
        lastTapTimeRef.current = 0;
        return;
      }
      lastTapTimeRef.current = now;

      if (zoomLevel > 1) {
        setIsPanning(true);
        panStartRef.current = {
          x: e.touches[0].clientX - panOffset.x,
          y: e.touches[0].clientY - panOffset.y,
        };
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStartDistRef.current !== null) {
      // Executa zoom em pinça
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const currentDist = Math.hypot(dx, dy);
      const scale = currentDist / pinchStartDistRef.current;
      const nextZoom = Math.max(1, Math.min(3.5, Number((pinchStartZoomRef.current * scale).toFixed(2))));
      setZoomLevel(nextZoom);
      if (nextZoom === 1) {
        setPanOffset({ x: 0, y: 0 });
      }
    } else if (e.touches.length === 1 && isPanning && zoomLevel > 1) {
      // Arraste com 1 dedo quando ampliado
      setPanOffset({
        x: e.touches[0].clientX - panStartRef.current.x,
        y: e.touches[0].clientY - panStartRef.current.y,
      });
    }
  };

  const handleTouchEnd = () => {
    pinchStartDistRef.current = null;
    setIsPanning(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      openCbzBlob(file);
    }
  };

  const currentPageEntry =
    indexSummary && snapshot
      ? indexSummary.pages[snapshot.currentPage]
      : undefined;

  return (
    <div
      ref={readerContainerRef}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDrop}
      className="flex flex-col flex-1 min-h-[calc(100vh-4rem)] bg-zinc-950 text-zinc-100 relative"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".cbz,.zip,application/vnd.comicbook+zip,application/zip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) openCbzBlob(f);
          e.target.value = '';
        }}
      />

      {/* Barra de Ferramentas Superior do Leitor */}
      {indexSummary && snapshot && (
        <div className="bg-zinc-900/90 backdrop-blur border-b border-zinc-800 px-3 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-2.5 z-20">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* Botão de Fechar / Sair bem visível e aparente */}
            <button
              onClick={handleCloseComic}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 text-xs font-semibold transition cursor-pointer shadow-sm shrink-0"
              title="Fechar quadrinho e voltar ao início (Atalho: Esc)"
            >
              <X className="w-3.5 h-3.5" />
              <span>Fechar</span>
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition border border-zinc-700 shrink-0"
              title="Abrir outro arquivo .cbz"
            >
              <Upload className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Trocar CBZ</span>
            </button>

            <div className="truncate">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-xs sm:text-sm text-zinc-100 truncate max-w-[140px] sm:max-w-xs md:max-w-md">
                  {indexSummary.comicInfo?.title || indexSummary.fileName}
                </span>
                <span className="hidden md:inline-block text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  {indexSummary.centralDirParseTimeMs} ms
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 truncate font-mono hidden sm:block">
                {currentPageEntry?.fileName} ({formatBytes(currentPageEntry?.compressedSize || 0)})
              </p>
            </div>
          </div>

          {/* Controles de Visualização */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            {/* Direção de Leitura: Ocidental LTR vs Mangá RTL */}
            <button
              onClick={() =>
                setDirection((d) => (d === 'ltr' ? 'rtl' : 'ltr'))
              }
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
                direction === 'rtl'
                  ? 'bg-rose-500/20 text-rose-200 border-rose-500/40'
                  : 'bg-zinc-800 text-zinc-200 border-zinc-700 hover:bg-zinc-700'
              }`}
              title="Alternar sentido de leitura Ocidental/Mangá (Atalho: M)"
            >
              <Repeat className="w-3.5 h-3.5" />
              <span className="hidden md:inline">
                {direction === 'ltr' ? 'Ocidental (→)' : 'Mangá RTL (←)'}
              </span>
            </button>

            {/* Ajuste de Enquadramento */}
            <div className="inline-flex rounded-lg bg-zinc-800 p-0.5 border border-zinc-700 text-xs">
              <button
                onClick={() => {
                  setFitMode('fit-height');
                  resetZoom();
                }}
                className={`px-2 py-1 rounded-md transition ${
                  fitMode === 'fit-height'
                    ? 'bg-amber-500 text-zinc-950 font-semibold'
                    : 'text-zinc-300 hover:text-white'
                }`}
                title="Ajustar à Altura da tela"
              >
                Altura
              </button>
              <button
                onClick={() => {
                  setFitMode('fit-width');
                  resetZoom();
                }}
                className={`px-2 py-1 rounded-md transition ${
                  fitMode === 'fit-width'
                    ? 'bg-amber-500 text-zinc-950 font-semibold'
                    : 'text-zinc-300 hover:text-white'
                }`}
                title="Ajustar à Largura da tela"
              >
                Largura
              </button>
            </div>

            {indexSummary.comicInfo && (
              <button
                onClick={() => setShowMetaModal(true)}
                className="inline-flex items-center gap-1 p-1.5 sm:px-2 sm:py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 border border-zinc-700"
                title="Ver ComicInfo.xml"
              >
                <Info className="w-3.5 h-3.5 text-sky-400" />
                <span className="hidden lg:inline">Info</span>
              </button>
            )}

            {/* Botão SUTIL do HUD de Telemetria da Janela Deslizante */}
            <button
              onClick={() => setShowHud((h) => !h)}
              className={`p-1.5 sm:px-2 sm:py-1.5 rounded-lg text-xs font-mono transition border ${
                showHud
                  ? 'bg-sky-500/20 text-sky-200 border-sky-500/40'
                  : 'bg-zinc-800/80 text-zinc-400 border-zinc-700/70 hover:text-zinc-200 hover:bg-zinc-700'
              }`}
              title="Alternar HUD da Janela Deslizante [N-1..N+3] (Atalho: I)"
            >
              <Cpu className="w-3.5 h-3.5 inline mr-1 text-sky-400" />
              <span className="text-[11px]">HUD</span>
            </button>

            <button
              onClick={toggleFullscreen}
              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
              title="Tela Cheia (Atalho: F)"
            >
              {isFullscreen ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Estado Inicial Vazio (Landing do Leitor) */}
      {!indexSummary && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div
            className={`max-w-2xl w-full rounded-2xl border-2 border-dashed p-8 sm:p-10 text-center transition ${
              isDraggingOver
                ? 'border-rose-400 bg-rose-500/10'
                : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700'
            }`}
          >
            <div className="w-16 h-16 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center mx-auto mb-5">
              <BookOpen className="w-8 h-8 text-rose-400" />
            </div>

            <h2 className="text-2xl font-bold text-zinc-100 mb-2 flex items-center justify-center gap-2">
              <span className="bg-gradient-to-r from-rose-400 via-amber-300 to-amber-500 bg-clip-text text-transparent">
                Proselytize Reader
              </span>
            </h2>
            <p className="text-sm text-zinc-400 max-w-lg mx-auto mb-6 leading-relaxed">
              Leitura instantânea exclusiva do <strong>Diretório Central ZIP</strong>{' '}
              (sem extrair o arquivo inteiro), ordenação via{' '}
              <strong>Transformada de Schwartz</strong> e cache de{' '}
              <strong>Janela Deslizante [N-1 .. N+3]</strong> com decodificação GPU
              assíncrona (<code className="text-rose-300">img.decode()</code>).
            </p>

            {errorMsg && (
              <div className="mb-6 p-3.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-200 text-xs text-left">
                {errorMsg}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoadingFile}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-semibold text-sm shadow-lg shadow-rose-500/20 transition cursor-pointer"
              >
                <FileArchive className="w-4 h-4" />
                Selecionar Arquivo .CBZ
              </button>

              <button
                onClick={handleLoadDemo}
                disabled={isLoadingFile}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-medium text-sm border border-zinc-700 transition cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-amber-400" />
                {isLoadingFile
                  ? 'Gerando CBZ Demo...'
                  : 'Carregar Quadrinho Demo (12 Páginas)'}
              </button>

              <button
                onClick={onSwitchToMaker}
                className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-sm border border-zinc-800 transition cursor-pointer"
              >
                <FolderPlus className="w-4 h-4 text-sky-400" />
                Ir para o Converter / Maker
              </button>
            </div>

            <div className="mt-8 pt-6 border-t border-zinc-800/80 grid grid-cols-1 sm:grid-cols-3 gap-3 text-left text-xs text-zinc-400">
              <div className="p-3 rounded-xl bg-zinc-900/90 border border-zinc-800">
                <div className="font-semibold text-zinc-200 mb-1 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  Zero Extração Total
                </div>
                Lê apenas os últimos 64 KB do ZIP (EOCD) e fatia bytes sob demanda.
              </div>
              <div className="p-3 rounded-xl bg-zinc-900/90 border border-zinc-800">
                <div className="font-semibold text-zinc-200 mb-1 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-sky-400" />
                  Janela [N-1 .. N+3]
                </div>
                Mantém no máximo 5 páginas na RAM e revoga URLs antigas imediatamente.
              </div>
              <div className="p-3 rounded-xl bg-zinc-900/90 border border-zinc-800">
                <div className="font-semibold text-zinc-200 mb-1 flex items-center gap-1.5">
                  <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                  Pinch &amp; Mouse Zoom
                </div>
                Gesto de pinça no celular, scroll no PC e arrasto fluído de tela.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Área Principal de Visualização + HUD da Janela Deslizante */}
      {indexSummary && snapshot && (
        <div className="flex-1 flex flex-col lg:flex-row relative overflow-hidden">
          {/* Viewport da Página com Suporte a Zoom e Pan */}
          <div
            onWheel={handleWheelZoom}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className={`flex-1 relative flex items-center justify-center bg-zinc-950 overflow-hidden select-none min-h-[70vh] ${
              zoomLevel > 1 ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
            }`}
          >
            {/* Zona de Clique Borda Esquerda (só atua sem zoom) */}
            <button
              type="button"
              onClick={handleLeftEdgeAction}
              aria-label="Borda esquerda de navegação"
              className={`fixed lg:absolute left-0 top-14 bottom-16 w-1/5 max-w-[140px] z-10 group flex items-center justify-start pl-3 focus:outline-none ${
                zoomLevel > 1 ? 'pointer-events-none' : 'cursor-pointer'
              }`}
            >
              <span className="p-2.5 rounded-full bg-zinc-900/80 border border-zinc-700 text-zinc-200 opacity-0 group-hover:opacity-100 transition shadow-lg">
                <ChevronLeft className="w-6 h-6" />
              </span>
            </button>

            {/* Zona de Clique Borda Direita (só atua sem zoom) */}
            <button
              type="button"
              onClick={handleRightEdgeAction}
              aria-label="Borda direita de navegação"
              className={`fixed lg:absolute right-0 top-14 bottom-16 w-1/5 max-w-[140px] z-10 group flex items-center justify-end pr-3 focus:outline-none ${
                zoomLevel > 1 ? 'pointer-events-none' : 'cursor-pointer'
              }`}
            >
              <span className="p-2.5 rounded-full bg-zinc-900/80 border border-zinc-700 text-zinc-200 opacity-0 group-hover:opacity-100 transition shadow-lg">
                <ChevronRight className="w-6 h-6" />
              </span>
            </button>

            {/* Barrinha Flutuante de Zoom */}
            <div className="absolute top-4 right-4 z-20 flex items-center gap-1.5 bg-zinc-900/85 backdrop-blur-md border border-zinc-700/80 px-2.5 py-1.5 rounded-xl text-xs font-mono shadow-xl">
              <button
                onClick={() =>
                  setZoomLevel((z) => {
                    const next = Math.max(1, Number((z - 0.25).toFixed(2)));
                    if (next === 1) setPanOffset({ x: 0, y: 0 });
                    return next;
                  })
                }
                disabled={zoomLevel <= 1}
                className="p-1 rounded-md hover:bg-zinc-800 disabled:opacity-40 text-zinc-300"
                title="Diminuir Zoom (-)"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>

              <span
                className={`min-w-[44px] text-center font-bold ${
                  zoomLevel > 1 ? 'text-amber-400' : 'text-zinc-400'
                }`}
              >
                {Math.round(zoomLevel * 100)}%
              </span>

              <button
                onClick={() =>
                  setZoomLevel((z) => Math.min(3.5, Number((z + 0.25).toFixed(2))))
                }
                disabled={zoomLevel >= 3.5}
                className="p-1 rounded-md hover:bg-zinc-800 disabled:opacity-40 text-zinc-300"
                title="Aumentar Zoom (+)"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>

              {zoomLevel > 1 && (
                <button
                  onClick={resetZoom}
                  className="ml-1 p-1 rounded-md hover:bg-rose-500/20 text-rose-300 border border-rose-500/30"
                  title="Resetar Zoom (0 ou Duplo Toque)"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Imagem Decodificada da Página Atual N com Transform de Zoom & Pan */}
            {snapshot.currentReadyPage ? (
              <div
                style={{
                  transform: `translate3d(${panOffset.x}px, ${panOffset.y}px, 0) scale(${zoomLevel})`,
                  transformOrigin: 'center center',
                  transition: isPanning ? 'none' : 'transform 120ms ease-out',
                }}
                className="flex items-center justify-center will-change-transform"
              >
                <img
                  key={snapshot.currentReadyPage.objectUrl}
                  src={snapshot.currentReadyPage.objectUrl}
                  alt={`Página ${snapshot.currentPage + 1}`}
                  draggable={false}
                  className={`shadow-2xl pointer-events-none select-none ${
                    fitMode === 'fit-height'
                      ? 'max-h-[calc(100vh-9.5rem)] w-auto object-contain'
                      : fitMode === 'fit-width'
                      ? 'w-full max-w-4xl h-auto object-contain'
                      : 'max-w-none'
                  }`}
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 text-zinc-400 py-24">
                <div className="w-10 h-10 rounded-full border-2 border-rose-400 border-t-transparent animate-spin" />
                <span className="text-xs font-mono">
                  Extraindo slice do ZIP &amp; decodificando página{' '}
                  {snapshot.currentPage + 1}...
                </span>
              </div>
            )}
          </div>

          {/* Painel Lateral / HUD da Janela Deslizante [N-1 .. N+3] e Transformada de Schwartz */}
          {showHud && (
            <aside className="w-full lg:w-80 xl:w-96 bg-zinc-900/95 border-t lg:border-t-0 lg:border-l border-zinc-800 p-4 flex flex-col gap-4 z-20 overflow-y-auto max-h-[85vh]">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5" />
                    Janela Deslizante [N-1 .. N+3]
                  </span>
                  <span className="text-[11px] font-mono text-zinc-400">
                    N = {snapshot.currentPage + 1} / {snapshot.totalPages}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400">
                  Páginas fora do intervalo{' '}
                  <code className="text-zinc-200">
                    [{snapshot.windowStart + 1}..{snapshot.windowEnd + 1}]
                  </code>{' '}
                  têm seu <code className="text-rose-300">ObjectURL</code> revogado
                  automaticamente da RAM.
                </p>
              </div>

              {/* Slots da Janela Deslizante */}
              <div className="space-y-2">
                {snapshot.slots.map((slot) => {
                  const isCurrent = slot.offset === 0;
                  const offsetLabel =
                    slot.offset === 0
                      ? 'N (ATUAL)'
                      : slot.offset > 0
                      ? `N+${slot.offset}`
                      : `N${slot.offset}`;

                  return (
                    <div
                      key={slot.offset}
                      onClick={() => {
                        if (slot.state !== 'out-of-bounds') {
                          goToPage(slot.pageIndex);
                        }
                      }}
                      className={`p-2.5 rounded-xl border text-xs transition ${
                        slot.state !== 'out-of-bounds' ? 'cursor-pointer' : 'opacity-45'
                      } ${
                        isCurrent
                          ? 'bg-rose-500/15 border-rose-500/50 text-rose-100'
                          : slot.state === 'ready'
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-zinc-200 hover:bg-emerald-500/15'
                          : slot.state === 'loading'
                          ? 'bg-sky-500/10 border-sky-500/30 text-sky-200'
                          : 'bg-zinc-950/60 border-zinc-800 text-zinc-500'
                      }`}
                    >
                      <div className="flex items-center justify-between font-mono mb-1">
                        <span className="font-bold">{offsetLabel}</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${
                            slot.state === 'ready'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : slot.state === 'loading'
                              ? 'bg-sky-500/20 text-sky-300 animate-pulse'
                              : 'bg-zinc-800 text-zinc-400'
                          }`}
                        >
                          {slot.state === 'ready'
                            ? 'Pronto (VRAM)'
                            : slot.state === 'loading'
                            ? 'Decodificando...'
                            : slot.state === 'out-of-bounds'
                            ? 'Fora do Limite'
                            : 'Fila'}
                        </span>
                      </div>

                      {slot.state !== 'out-of-bounds' && (
                        <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono truncate">
                          <span className="truncate max-w-[160px]">
                            Pág {slot.pageIndex + 1}: {slot.fileName}
                          </span>
                          {slot.byteSize !== undefined && (
                            <span>
                              {formatBytes(slot.byteSize)} • {slot.decodeTimeMs}ms
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Métricas de Memória e Cancelamento */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800">
                  <div className="text-[10px] text-zinc-400 uppercase">
                    RAM na Janela
                  </div>
                  <div className="text-xs font-mono font-bold text-emerald-400 mt-0.5">
                    {formatBytes(snapshot.activeRamBytes)}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800">
                  <div className="text-[10px] text-zinc-400 uppercase">
                    Págs Liberadas
                  </div>
                  <div className="text-xs font-mono font-bold text-rose-400 mt-0.5">
                    {snapshot.evictedTotalCount} revogadas
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800">
                  <div className="text-[10px] text-zinc-400 uppercase">
                    Tasks Abortadas
                  </div>
                  <div className="text-xs font-mono font-bold text-amber-400 mt-0.5">
                    {snapshot.abortedTasksCount} canceladas
                  </div>
                </div>
              </div>

              {/* Inspecionador da Chave da Transformada de Schwartz */}
              {currentPageEntry?.schwartzKey && (
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-xs space-y-1.5">
                  <div className="font-semibold text-rose-300 flex items-center justify-between">
                    <span>Chave de Schwartz (Página Atual)</span>
                    <span className="text-[10px] font-mono text-zinc-400">
                      O(N) Key Extraction
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-zinc-300 break-all bg-zinc-900 p-2 rounded border border-zinc-800">
                    {currentPageEntry.schwartzKey.formattedKey}
                  </div>
                  <div className="text-[11px] text-zinc-400 flex justify-between font-mono">
                    <span>
                      Offset ZIP: 0x
                      {currentPageEntry.localHeaderOffset.toString(16).toUpperCase()}
                    </span>
                    <span>
                      Método:{' '}
                      {currentPageEntry.compressionMethod === 0
                        ? 'STORE (0)'
                        : 'DEFLATE (8)'}
                    </span>
                  </div>
                </div>
              )}

              {/* Atalhos Rápidos */}
              <div className="mt-auto pt-2 border-t border-zinc-800 text-[11px] text-zinc-400 space-y-1">
                <div className="font-semibold text-zinc-300">
                  Atalhos de Navegação:
                </div>
                <div className="grid grid-cols-2 gap-1 font-mono">
                  <span>Esc: Fechar / Reset</span>
                  <span>Scroll: Zoom</span>
                  <span>← / → ou A / D: Virar</span>
                  <span>Espaço: Próxima</span>
                  <span>M: Alternar RTL/LTR</span>
                  <span>V: Altura/Largura</span>
                  <span>I: Alternar HUD</span>
                  <span>F: Tela Cheia</span>
                </div>
              </div>
            </aside>
          )}
        </div>
      )}

      {/* Barra Inferior de Progresso Interativa (Scrubber) */}
      {indexSummary && snapshot && (
        <div className="bg-zinc-900/95 border-t border-zinc-800 px-4 py-2.5 flex items-center gap-4 z-20">
          <button
            onClick={handleLeftEdgeAction}
            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700"
            title="Página Anterior / Esquerda"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="flex-1 flex items-center gap-3">
            <span className="text-xs font-mono text-rose-300 font-semibold min-w-[76px]">
              Pág {snapshot.currentPage + 1} / {snapshot.totalPages}
            </span>

            <input
              type="range"
              min={0}
              max={Math.max(0, snapshot.totalPages - 1)}
              value={snapshot.currentPage}
              onChange={(e) => goToPage(parseInt(e.target.value, 10))}
              className={`flex-1 accent-rose-500 h-2 bg-zinc-800 rounded-lg cursor-pointer ${
                direction === 'rtl' ? 'rotate-180' : ''
              }`}
            />
          </div>

          <button
            onClick={handleRightEdgeAction}
            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700"
            title="Próxima Página / Direita"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Modal de Metadados ComicInfo.xml */}
      {showMetaModal && indexSummary?.comicInfo && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="font-bold text-base text-zinc-100 flex items-center gap-2">
                <Info className="w-4 h-4 text-sky-400" />
                Metadados ComicInfo.xml
              </h3>
              <button
                onClick={() => setShowMetaModal(false)}
                className="text-xs text-zinc-400 hover:text-white"
              >
                Fechar
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <div>
                <span className="text-zinc-400">Título:</span>{' '}
                <span className="text-zinc-100 font-medium">
                  {indexSummary.comicInfo.title || '—'}
                </span>
              </div>
              <div>
                <span className="text-zinc-400">Série:</span>{' '}
                <span className="text-zinc-100 font-medium">
                  {indexSummary.comicInfo.series || '—'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-zinc-400">Volume:</span>{' '}
                  <span className="text-zinc-100">
                    {indexSummary.comicInfo.volume || '—'}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-400">Número:</span>{' '}
                  <span className="text-zinc-100">
                    {indexSummary.comicInfo.number || '—'}
                  </span>
                </div>
              </div>
              <div>
                <span className="text-zinc-400">Autor / Roteiro:</span>{' '}
                <span className="text-zinc-100">
                  {indexSummary.comicInfo.writer || '—'}
                </span>
              </div>
              <div>
                <span className="text-zinc-400">Direção Mangá:</span>{' '}
                <span className="text-zinc-100">
                  {indexSummary.comicInfo.manga || 'No'}
                </span>
              </div>
              {indexSummary.comicInfo.summary && (
                <div className="pt-2 border-t border-zinc-800">
                  <span className="text-zinc-400 block mb-1">Sinopse:</span>
                  <p className="text-zinc-300 leading-relaxed">
                    {indexSummary.comicInfo.summary}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
