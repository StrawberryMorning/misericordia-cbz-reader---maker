import {
  extractSingleEntryBytes,
  inferMimeType,
  ZipCentralEntry,
} from './zipCentralDirectory';

export interface CachedPage {
  pageIndex: number;
  fileName: string;
  objectUrl: string;
  byteSize: number;
  width: number;
  height: number;
  decodeTimeMs: number;
  decodedAt: number;
}

export type SlotState = 'ready' | 'loading' | 'idle' | 'out-of-bounds';

export interface WindowSlotStatus {
  offset: number; // -1, 0, +1, +2, +3
  pageIndex: number;
  state: SlotState;
  fileName?: string;
  byteSize?: number;
  decodeTimeMs?: number;
  dimensions?: string;
}

export interface SlidingWindowSnapshot {
  currentPage: number;
  totalPages: number;
  windowStart: number;
  windowEnd: number;
  activeCacheCount: number;
  activeRamBytes: number;
  evictedTotalCount: number;
  abortedTasksCount: number;
  slots: WindowSlotStatus[];
  currentReadyPage: CachedPage | null;
  nextPageReady: CachedPage | null;
}

export type PageBytesExtractor = (
  pageIndex: number,
  entry: ZipCentralEntry,
  signal: AbortSignal
) => Promise<Uint8Array>;

/**
 * Gerenciador de Janela Deslizante [N - 1 .. N + 3].
 * Mantém apenas 5 páginas adjacentes na memória RAM/VRAM, revogando ObjectURLs
 * e cancelando extrações pendentes fora da janela a cada mudança de página.
 */
export class SlidingWindowCacheManager {
  private pages: ZipCentralEntry[];
  private extractor: PageBytesExtractor;
  private onUpdate: (snapshot: SlidingWindowSnapshot) => void;

  private currentPage = 0;
  private cache = new Map<number, CachedPage>();
  private inFlight = new Map<number, AbortController>();

  private evictedTotalCount = 0;
  private abortedTasksCount = 0;
  private destroyed = false;

  constructor(
    pages: ZipCentralEntry[],
    extractor: PageBytesExtractor,
    onUpdate: (snapshot: SlidingWindowSnapshot) => void
  ) {
    this.pages = pages;
    this.extractor = extractor;
    this.onUpdate = onUpdate;
  }

  public static fromFileOrBlob(
    file: File | Blob,
    pages: ZipCentralEntry[],
    onUpdate: (snapshot: SlidingWindowSnapshot) => void
  ): SlidingWindowCacheManager {
    return new SlidingWindowCacheManager(
      pages,
      (_idx, entry, signal) => extractSingleEntryBytes(file, entry, signal),
      onUpdate
    );
  }

  public getValidWindowRange(centerPage: number): [number, number] {
    if (this.pages.length === 0) return [0, -1];
    const start = Math.max(0, centerPage - 1);
    const end = Math.min(this.pages.length - 1, centerPage + 3);
    return [start, end];
  }

  /**
   * Atualiza o índice N da página atual e executa o ciclo completo da janela deslizante:
   * 1. Revoga e destrói imagens fora de [N - 1, N + 3]
   * 2. Cancela tarefas de extração assíncrona pendentes fora da janela
   * 3. Dispara extração e image.decode() assíncrono em segundo plano para novos índices
   */
  public navigateTo(targetPage: number): void {
    if (this.destroyed || this.pages.length === 0) return;

    const clamped = Math.max(0, Math.min(this.pages.length - 1, targetPage));
    this.currentPage = clamped;

    const [winStart, winEnd] = this.getValidWindowRange(clamped);

    // 1. Limpeza explícita de memória (Eviction de páginas fora de [N-1 .. N+3])
    for (const [cachedIdx, cachedPage] of this.cache.entries()) {
      if (cachedIdx < winStart || cachedIdx > winEnd) {
        URL.revokeObjectURL(cachedPage.objectUrl);
        this.cache.delete(cachedIdx);
        this.evictedTotalCount++;
      }
    }

    // 2. Cancelamento de extrações pendentes fora da nova janela
    for (const [loadingIdx, controller] of this.inFlight.entries()) {
      if (loadingIdx < winStart || loadingIdx > winEnd) {
        controller.abort();
        this.inFlight.delete(loadingIdx);
        this.abortedTasksCount++;
      }
    }

    // 3. Ordem de prioridade de carregamento: N (atual), N+1, N-1, N+2, N+3
    const priorityOrder = [
      clamped,
      clamped + 1,
      clamped - 1,
      clamped + 2,
      clamped + 3,
    ].filter((idx) => idx >= winStart && idx <= winEnd);

    for (const idx of priorityOrder) {
      if (!this.cache.has(idx) && !this.inFlight.has(idx)) {
        this.preloadPageInBackground(idx);
      }
    }

    this.emitSnapshot();
  }

  private async preloadPageInBackground(pageIndex: number): Promise<void> {
    const entry = this.pages[pageIndex];
    if (!entry) return;

    const controller = new AbortController();
    this.inFlight.set(pageIndex, controller);
    this.emitSnapshot();

    const t0 = performance.now();

    try {
      const bytes = await this.extractor(pageIndex, entry, controller.signal);

      if (controller.signal.aborted || this.destroyed) {
        return;
      }

      const mimeType = inferMimeType(entry.fileName);
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
      const objectUrl = URL.createObjectURL(blob);

      try {
        // Força a decodificação assíncrona dos pixels para a memória de vídeo antes de exibir
        const img = new Image();
        img.decoding = 'async';
        img.src = objectUrl;
        await img.decode();

        if (controller.signal.aborted || this.destroyed) {
          URL.revokeObjectURL(objectUrl);
          return;
        }

        const decodeTimeMs = Math.max(1, Math.round(performance.now() - t0));

        const [winStart, winEnd] = this.getValidWindowRange(this.currentPage);
        if (pageIndex < winStart || pageIndex > winEnd) {
          URL.revokeObjectURL(objectUrl);
          this.abortedTasksCount++;
          return;
        }

        this.cache.set(pageIndex, {
          pageIndex,
          fileName: entry.fileName,
          objectUrl,
          byteSize: bytes.byteLength,
          width: img.naturalWidth || 0,
          height: img.naturalHeight || 0,
          decodeTimeMs,
          decodedAt: Date.now(),
        });
      } catch (decodeErr) {
        URL.revokeObjectURL(objectUrl);
        throw decodeErr;
      }
    } catch {
      // Erros de AbortController são esperados quando o usuário pula páginas rapidamente
    } finally {
      this.inFlight.delete(pageIndex);
      if (!this.destroyed) {
        this.emitSnapshot();
      }
    }
  }

  private emitSnapshot(): void {
    const [winStart, winEnd] = this.getValidWindowRange(this.currentPage);
    const offsets = [-1, 0, 1, 2, 3];

    const slots: WindowSlotStatus[] = offsets.map((offset) => {
      const idx = this.currentPage + offset;
      if (idx < 0 || idx >= this.pages.length) {
        return {
          offset,
          pageIndex: idx,
          state: 'out-of-bounds',
        };
      }

      const cached = this.cache.get(idx);
      if (cached) {
        return {
          offset,
          pageIndex: idx,
          state: 'ready',
          fileName: cached.fileName,
          byteSize: cached.byteSize,
          decodeTimeMs: cached.decodeTimeMs,
          dimensions: `${cached.width}×${cached.height}`,
        };
      }

      if (this.inFlight.has(idx)) {
        return {
          offset,
          pageIndex: idx,
          state: 'loading',
          fileName: this.pages[idx]?.fileName,
        };
      }

      return {
        offset,
        pageIndex: idx,
        state: 'idle',
        fileName: this.pages[idx]?.fileName,
      };
    });

    let activeRamBytes = 0;
    for (const item of this.cache.values()) {
      activeRamBytes += item.byteSize;
    }

    this.onUpdate({
      currentPage: this.currentPage,
      totalPages: this.pages.length,
      windowStart: winStart,
      windowEnd: winEnd,
      activeCacheCount: this.cache.size,
      activeRamBytes,
      evictedTotalCount: this.evictedTotalCount,
      abortedTasksCount: this.abortedTasksCount,
      slots,
      currentReadyPage: this.cache.get(this.currentPage) || null,
      nextPageReady: this.cache.get(this.currentPage + 1) || null,
    });
  }

  /**
   * Destrói toda a janela deslizante e libera todos os ObjectURLs da memória.
   */
  public dispose(): void {
    this.destroyed = true;
    for (const controller of this.inFlight.values()) {
      controller.abort();
    }
    this.inFlight.clear();

    for (const cached of this.cache.values()) {
      URL.revokeObjectURL(cached.objectUrl);
    }
    this.cache.clear();
  }
}
