import { inflateSync, zipSync, Zippable } from 'fflate';
import {
  isValidImageEntry,
  schwartzNaturalSort,
  SchwartzSortKey,
} from './schwartzSort';
import { ComicInfoMetadata, parseComicInfoXml } from './comicInfo';

export interface ZipCentralEntry {
  fileName: string;
  compressionMethod: number; // 0 = STORE, 8 = DEFLATE
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  schwartzKey?: SchwartzSortKey;
}

export interface CbzIndexSummary {
  fileName: string;
  fileSize: number;
  pages: ZipCentralEntry[];
  comicInfo: Partial<ComicInfoMetadata> | null;
  centralDirParseTimeMs: number;
  schwartzSortTimeUs: number;
  totalEntriesInZip: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;

export function inferMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  return 'image/jpeg';
}

/**
 * Lê EXCLUSIVAMENTE o Diretório Central no final do arquivo .cbz (usando Blob.slice),
 * sem extrair nenhuma imagem para o disco ou para a memória RAM principal.
 */
export async function readCbzCentralDirectory(
  file: File | Blob,
  displayFileName = 'archive.cbz'
): Promise<CbzIndexSummary> {
  const tStart = performance.now();
  const fileSize = file.size;

  // O End of Central Directory (EOCD) fica nos últimos 65.557 bytes do arquivo ZIP
  const maxTailSize = Math.min(fileSize, 65557);
  const tailOffset = fileSize - maxTailSize;
  const tailBuffer = await file.slice(tailOffset, fileSize).arrayBuffer();
  const tailView = new DataView(tailBuffer);

  let eocdPos = -1;
  for (let pos = maxTailSize - 22; pos >= 0; pos--) {
    if (tailView.getUint32(pos, true) === EOCD_SIGNATURE) {
      eocdPos = pos;
      break;
    }
  }

  if (eocdPos === -1) {
    throw new Error(
      'Assinatura do Diretório Central ZIP (EOCD) não encontrada. O arquivo pode estar corrompido ou não é um .cbz válido.'
    );
  }

  const totalEntries = tailView.getUint16(eocdPos + 10, true);
  const centralDirSize = tailView.getUint32(eocdPos + 12, true);
  const centralDirOffset = tailView.getUint32(eocdPos + 16, true);

  // Lê apenas os bytes do Diretório Central (normalmente poucos KB mesmo em CBZ de 1 GB)
  const cdBuffer = await file
    .slice(centralDirOffset, centralDirOffset + centralDirSize)
    .arrayBuffer();
  const cdView = new DataView(cdBuffer);
  const cdBytes = new Uint8Array(cdBuffer);
  const textDecoder = new TextDecoder('utf-8');

  const rawImageEntries: ZipCentralEntry[] = [];
  let comicInfoEntry: ZipCentralEntry | null = null;

  let ptr = 0;
  for (let i = 0; i < totalEntries && ptr + 46 <= cdBuffer.byteLength; i++) {
    const sig = cdView.getUint32(ptr, true);
    if (sig !== CENTRAL_FILE_HEADER_SIGNATURE) {
      break;
    }

    const compressionMethod = cdView.getUint16(ptr + 10, true);
    const compressedSize = cdView.getUint32(ptr + 20, true);
    const uncompressedSize = cdView.getUint32(ptr + 24, true);
    const fileNameLen = cdView.getUint16(ptr + 28, true);
    const extraFieldLen = cdView.getUint16(ptr + 30, true);
    const fileCommentLen = cdView.getUint16(ptr + 32, true);
    const localHeaderOffset = cdView.getUint32(ptr + 42, true);

    const nameBytes = cdBytes.subarray(ptr + 46, ptr + 46 + fileNameLen);
    const entryName = textDecoder.decode(nameBytes);

    if (entryName.toLowerCase().endsWith('comicinfo.xml')) {
      comicInfoEntry = {
        fileName: entryName,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      };
    } else if (isValidImageEntry(entryName)) {
      rawImageEntries.push({
        fileName: entryName,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });
    }

    ptr += 46 + fileNameLen + extraFieldLen + fileCommentLen;
  }

  const tAfterCd = performance.now();

  // Aplica a Transformada de Schwartz (Key Extraction) para ordenar naturalmente as páginas
  const sortResult = schwartzNaturalSort(
    rawImageEntries,
    (entry) => entry.fileName
  );

  const sortedPages: ZipCentralEntry[] = sortResult.indexed.map((idxItem) => ({
    ...idxItem.item,
    schwartzKey: idxItem.key,
  }));

  // Se houver ComicInfo.xml, extrai apenas os seus poucos bytes de texto
  let comicInfo: Partial<ComicInfoMetadata> | null = null;
  if (comicInfoEntry) {
    try {
      const xmlBytes = await extractSingleEntryBytes(file, comicInfoEntry);
      const xmlString = textDecoder.decode(xmlBytes);
      comicInfo = parseComicInfoXml(xmlString);
    } catch {
      comicInfo = null;
    }
  }

  return {
    fileName: displayFileName,
    fileSize,
    pages: sortedPages,
    comicInfo,
    centralDirParseTimeMs: Number((tAfterCd - tStart).toFixed(2)),
    schwartzSortTimeUs: sortResult.durationUs,
    totalEntriesInZip: totalEntries,
  };
}

/**
 * Extrai sob demanda APENAS os bytes de uma única entrada específica do arquivo ZIP
 * usando offset direto (Random Access Slice), respeitando cancelamento via AbortSignal.
 */
export async function extractSingleEntryBytes(
  file: File | Blob,
  entry: ZipCentralEntry,
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (signal?.aborted) {
    throw new DOMException('Extração cancelada pela janela deslizante', 'AbortError');
  }

  // Lê o cabeçalho local (30 bytes) para descobrir o tamanho variável do nome/extra local
  const localHeaderSlice = file.slice(
    entry.localHeaderOffset,
    entry.localHeaderOffset + 30
  );
  const localHeaderBuf = await localHeaderSlice.arrayBuffer();

  if (signal?.aborted) {
    throw new DOMException('Extração cancelada pela janela deslizante', 'AbortError');
  }

  const localView = new DataView(localHeaderBuf);
  const sig = localView.getUint32(0, true);
  if (sig !== LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error(`Cabeçalho local ZIP inválido para a página ${entry.fileName}`);
  }

  const localNameLen = localView.getUint16(26, true);
  const localExtraLen = localView.getUint16(28, true);
  const dataStartOffset =
    entry.localHeaderOffset + 30 + localNameLen + localExtraLen;
  const dataEndOffset = dataStartOffset + entry.compressedSize;

  // Lê exclusivamente o intervalo de bytes desta página
  const payloadBuffer = await file
    .slice(dataStartOffset, dataEndOffset)
    .arrayBuffer();

  if (signal?.aborted) {
    throw new DOMException('Extração cancelada pela janela deslizante', 'AbortError');
  }

  const rawBytes = new Uint8Array(payloadBuffer);

  if (entry.compressionMethod === 0) {
    // Modo STORE (Nível 0): Zero descompressão necessária!
    return rawBytes;
  } else if (entry.compressionMethod === 8) {
    // Modo DEFLATE: Descomprime apenas os bytes desta página
    return inflateSync(rawBytes);
  } else {
    throw new Error(
      `Método de compressão ZIP (${entry.compressionMethod}) não suportado.`
    );
  }
}

/**
 * Empacota uma lista de arquivos já ordenados e renomeados em um arquivo .cbz
 * com nível de compressão ZIP configurável:
 * 0 = STORE (Sem compressão, ideal para imagens), 1 = Deflate Rápido, 6 = Padrão, 9 = Máximo.
 */
export function createCbzBlob(
  entries: { archiveName: string; data: Uint8Array }[],
  comicInfoXml?: string,
  compressionLevel: 0 | 1 | 6 | 9 = 0
): Blob {
  const zipStructure: Zippable = {};

  if (comicInfoXml) {
    const encoder = new TextEncoder();
    zipStructure['ComicInfo.xml'] = [
      encoder.encode(comicInfoXml),
      { level: compressionLevel },
    ];
  }

  for (const item of entries) {
    zipStructure[item.archiveName] = [item.data, { level: compressionLevel }];
  }

  const zippedBytes = zipSync(zipStructure, { level: compressionLevel });
  return new Blob([zippedBytes.buffer as ArrayBuffer], {
    type: 'application/vnd.comicbook+zip',
  });
}

/**
 * Empacota uma lista de arquivos já ordenados e renomeados em um arquivo .cbz
 * configurado no modo STORE (Nível 0 - Sem Compressão), ideal para imagens.
 */
export function createStoreCbzBlob(
  entries: { archiveName: string; data: Uint8Array }[],
  comicInfoXml?: string
): Blob {
  return createCbzBlob(entries, comicInfoXml, 0);
}
