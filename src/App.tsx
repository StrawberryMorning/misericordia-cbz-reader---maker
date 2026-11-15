import React, { useState } from 'react';
import { BookOpen, Cpu, FileCode, FolderPlus, Sparkles } from 'lucide-react';
import { CbzReaderView } from './components/CbzReaderView';
import { CbzMakerView } from './components/CbzMakerView';
import { MetadataStudioView } from './components/MetadataStudioView';
import { isTauriDesktop } from './core/runtimeAdapter';

export type ActiveTab = 'reader' | 'maker' | 'metadata';

const APP_VERSION = 'v1.1.0';

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('reader');
  const [sharedCbzFile, setSharedCbzFile] = useState<File | null>(null);
  const tauriMode = isTauriDesktop();

  const handleOpenCreatedInReader = (file: File) => {
    setSharedCbzFile(file);
    setActiveTab('reader');
  };

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100 selection:bg-rose-500/30 selection:text-rose-200">
      {/* Header Principal */}
      <header className="h-16 border-b border-zinc-800/90 bg-zinc-950/90 backdrop-blur px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="relative group cursor-pointer">
            <img
              src="/brand/strawberry-elephant.jpg"
              alt="Elefante Morango - Manhã de Morango S/A"
              className="w-10 h-10 rounded-xl object-cover border-2 border-rose-500/40 shadow-md shadow-rose-500/20 group-hover:scale-105 transition-transform"
            />
            <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-rose-500 rounded-full border-2 border-zinc-950" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-base sm:text-lg tracking-tight bg-gradient-to-r from-rose-400 via-amber-300 to-amber-500 bg-clip-text text-transparent">
                Proselytize
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300">
                Manhã de Morango S/A
              </span>
              <span className="hidden md:inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400">
                <Cpu className="w-3 h-3 text-amber-400" />
                {tauriMode ? 'Rust Engine' : 'Web + CLI Suite'}
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 hidden sm:block">
              Convertendo arquivos para a alta performance • Reader, Converter &amp; Metadata Studio
            </p>
          </div>
        </div>

        {/* Seletor de Módulos: Reader vs Maker vs Metadata Studio */}
        <nav className="flex items-center gap-1 sm:gap-1.5 bg-zinc-900 p-1 rounded-xl border border-zinc-800">
          <button
            onClick={() => setActiveTab('reader')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition cursor-pointer ${
              activeTab === 'reader'
                ? 'bg-rose-500 text-white shadow-md shadow-rose-500/25'
                : 'text-zinc-300 hover:text-white'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Reader</span>
          </button>

          <button
            onClick={() => setActiveTab('maker')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition cursor-pointer ${
              activeTab === 'maker'
                ? 'bg-rose-500 text-white shadow-md shadow-rose-500/25'
                : 'text-zinc-300 hover:text-white'
            }`}
          >
            <FolderPlus className="w-4 h-4" />
            <span>Converter</span>
          </button>

          <button
            onClick={() => setActiveTab('metadata')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition cursor-pointer ${
              activeTab === 'metadata'
                ? 'bg-rose-500 text-white shadow-md shadow-rose-500/25'
                : 'text-zinc-300 hover:text-white'
            }`}
          >
            <FileCode className="w-4 h-4" />
            <span>Metadados</span>
          </button>
        </nav>
      </header>

      {/* Conteúdo Ativo */}
      <main className="flex-1 flex flex-col">
        {activeTab === 'reader' ? (
          <CbzReaderView
            externalCbzFile={sharedCbzFile}
            onSwitchToMaker={() => setActiveTab('maker')}
          />
        ) : activeTab === 'maker' ? (
          <CbzMakerView onOpenCreatedCbzInReader={handleOpenCreatedInReader} />
        ) : (
          <MetadataStudioView
            externalCbzFile={sharedCbzFile}
            onOpenUpdatedCbzInReader={handleOpenCreatedInReader}
          />
        )}
      </main>

      {/* Rodapé com Marca Registrada, Mascote Elefante Morango e Versão */}
      <footer className="border-t border-zinc-800/80 bg-zinc-950/80 backdrop-blur py-4 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-400">
          <div className="flex items-center gap-2.5">
            <img
              src="/brand/strawberry-elephant.jpg"
              alt="Elefante Morango"
              className="w-6 h-6 rounded-lg object-cover border border-rose-500/30"
            />
            <span>
              Marca Registrada: <strong className="text-zinc-200">Manhã de Morango S/A</strong> &copy; {new Date().getFullYear()}
            </span>
          </div>

          <div className="flex items-center gap-3 font-mono text-[11px]">
            <span className="flex items-center gap-1 text-zinc-500">
              <Sparkles className="w-3 h-3 text-rose-400" />
              Schwartzian Key Extraction &bull; WebP Engine &bull; ComicInfo Studio &bull; CLI
            </span>
            <span className="px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-rose-300 font-semibold">
              {APP_VERSION}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
