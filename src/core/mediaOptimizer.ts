import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

export type MediaOptimizationMode = 'original' | 'webp';
export type ZipCompressionLevel = 0 | 1 | 6 | 9;

export interface OptimizedImageResult {
  data: Uint8Array;
  width: number;
  height: number;
  originalSize: number;
  optimizedSize: number;
}

export interface RasterizedPdfPage {
  pageNumber: number;
  virtualName: string;
  data: Uint8Array;
  byteSize: number;
}

/**
 * Converte bytes de imagem (PNG, JPG, JPEG, BMP, GIF, WebP) para WebP otimizado
 * usando Canvas, com controle de qualidade e redimensionamento proporcional opcional.
 */
export async function optimizeImageToWebP(
  sourceBytes: Uint8Array,
  sourceMime: string,
  qualityPercent: number,
  maxWidth: number | null
): Promise<OptimizedImageResult> {
  const originalSize = sourceBytes.byteLength;
  const blob = new Blob([sourceBytes.buffer as ArrayBuffer], {
    type: sourceMime,
  });

  let bitmap: ImageBitmap | null = null;
  let width = 0;
  let height = 0;

  try {
    bitmap = await createImageBitmap(blob);
    width = bitmap.width;
    height = bitmap.height;
  } catch {
    // Fallback caso createImageBitmap falhe para algum formato específico
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Falha ao decodificar imagem'));
        el.src = url;
      });
      width = img.naturalWidth;
      height = img.naturalHeight;

      const targetSize = computeTargetDimensions(width, height, maxWidth);
      const canvas = document.createElement('canvas');
      canvas.width = targetSize.width;
      canvas.height = targetSize.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Contexto 2D indisponível');
      ctx.drawImage(img, 0, 0, targetSize.width, targetSize.height);

      const webpBlob = await canvasToWebpBlob(canvas, qualityPercent);
      const outBytes = new Uint8Array(await webpBlob.arrayBuffer());
      return {
        data: outBytes,
        width: targetSize.width,
        height: targetSize.height,
        originalSize,
        optimizedSize: outBytes.byteLength,
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  try {
    const targetSize = computeTargetDimensions(width, height, maxWidth);
    const canvas = document.createElement('canvas');
    canvas.width = targetSize.width;
    canvas.height = targetSize.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Contexto 2D indisponível');

    ctx.drawImage(bitmap, 0, 0, targetSize.width, targetSize.height);
    const webpBlob = await canvasToWebpBlob(canvas, qualityPercent);
    const outBytes = new Uint8Array(await webpBlob.arrayBuffer());

    return {
      data: outBytes,
      width: targetSize.width,
      height: targetSize.height,
      originalSize,
      optimizedSize: outBytes.byteLength,
    };
  } finally {
    bitmap?.close();
  }
}

function computeTargetDimensions(
  width: number,
  height: number,
  maxWidth: number | null
): { width: number; height: number } {
  if (!maxWidth || width <= maxWidth || width === 0) {
    return { width, height };
  }
  const ratio = maxWidth / width;
  return {
    width: maxWidth,
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function canvasToWebpBlob(
  canvas: HTMLCanvasElement,
  qualityPercent: number
): Promise<Blob> {
  const q = Math.max(0.1, Math.min(1.0, qualityPercent / 100));
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('Falha ao codificar WebP'));
      },
      'image/webp',
      q
    );
  });
}

/**
 * Rasteriza todas as páginas de um arquivo .PDF em imagens WebP (ou PNG/JPEG)
 * diretamente no navegador usando pdfjs-dist.
 */
export async function rasterizePdfToPages(
  pdfFile: File,
  options: {
    targetFormat: 'webp' | 'png' | 'jpeg';
    qualityPercent: number;
    maxWidth: number | null;
    onProgress?: (current: number, total: number) => void;
  }
): Promise<RasterizedPdfPage[]> {
  const arrayBuffer = await pdfFile.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdfDoc = await loadingTask.promise;
  const totalPages = pdfDoc.numPages;

  const baseName = pdfFile.name.replace(/\.pdf$/i, '');
  const digits = Math.max(3, String(totalPages).length);
  const results: RasterizedPdfPage[] = [];

  const mimeType =
    options.targetFormat === 'webp'
      ? 'image/webp'
      : options.targetFormat === 'png'
      ? 'image/png'
      : 'image/jpeg';
  const ext = options.targetFormat === 'jpeg' ? 'jpg' : options.targetFormat;
  const quality = Math.max(0.1, Math.min(1.0, options.qualityPercent / 100));

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const baseViewport = page.getViewport({ scale: 1.0 });

    // Escala padrão 2.0 (~144-200 DPI) para leitura nítida, respeitando maxWidth se definido
    let scale = 2.0;
    if (options.maxWidth && baseViewport.width > 0) {
      const targetScale = options.maxWidth / baseViewport.width;
      scale = Math.min(scale, targetScale);
    }
    scale = Math.max(0.5, scale);

    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Contexto 2D indisponível ao renderizar PDF');

    // Fundo branco para páginas PDF transparentes
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport,
      canvas,
    }).promise;

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Falha ao exportar página do PDF'))),
        mimeType,
        quality
      );
    });

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const paddedNum = String(pageNum).padStart(digits, '0');

    results.push({
      pageNumber: pageNum,
      virtualName: `${baseName}_p${paddedNum}.${ext}`,
      data: bytes,
      byteSize: bytes.byteLength,
    });

    options.onProgress?.(pageNum, totalPages);
  }

  return results;
}
