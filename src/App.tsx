import React, { useState } from 'react';
import { BookOpen, Cpu, FolderPlus, Layers } from 'lucide-react';
import { CbzReaderView } from './components/CbzReaderView';
import { CbzMakerView } from './components/CbzMakerView';
import { isTauriDesktop } from './core/runtimeAdapter';

export type ActiveTab = 'reader' | 'maker';

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('reader');
  const [sharedCbzFile, setSharedCbzFile] = useState<File | null>(null);
  const tauriMode = isTauriDesktop();

  const handleOpenCreatedInReader = (file: File) => {
    setSharedCbzFile(file);
    setActiveTab('reader');
  };

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
      {/* Header Principal */}
      <header className="h-16 border-b border-zinc-800/90 bg-zinc-950/90 backdrop-blur px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-zinc-950 font-black shadow-md shadow-amber-500/20">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm sm:text-base tracking-tight text-zinc-100">
                misericordia-cbz-reader-&amp;-maker
              </span>
              <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400">
                <Cpu className="w-3 h-3 text-amber-400" />
                {tauriMode ? 'Tauri + Rust Native' : 'Web Engine + Rust/Tauri Ready'}
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 hidden sm:block">
              Schwartzian Transform O(N) • Central Directory ZIP • Sliding Window [N-1..N+3]
            </p>
          </div>
        </div>

        {/* Seletor de Módulos: Reader vs Maker */}
        <nav className="flex items-center gap-1.5 bg-zinc-900 p-1 rounded-xl border border-zinc-800">
          <button
            onClick={() => setActiveTab('reader')}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition cursor-pointer ${
              activeTab === 'reader'
                ? 'bg-amber-500 text-zinc-950 shadow'
                : 'text-zinc-300 hover:text-white'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            CBZ Reader
          </button>

          <button
            onClick={() => setActiveTab('maker')}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition cursor-pointer ${
              activeTab === 'maker'
                ? 'bg-amber-500 text-zinc-950 shadow'
                : 'text-zinc-300 hover:text-white'
            }`}
          >
            <FolderPlus className="w-4 h-4" />
            CBZ Maker
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
        ) : (
          <CbzMakerView onOpenCreatedCbzInReader={handleOpenCreatedInReader} />
        )}
      </main>
    </div>
  );
}

export default App;
