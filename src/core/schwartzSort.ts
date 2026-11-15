export type KeySegment =
  | { kind: 'text'; value: string }
  | { kind: 'num'; value: bigint };

export interface SchwartzSortKey {
  rawName: string;
  segments: KeySegment[];
  formattedKey: string;
}

export interface SchwartzIndexedItem<T> {
  item: T;
  key: SchwartzSortKey;
}

export interface SchwartzSortResult<T> {
  sorted: T[];
  indexed: SchwartzIndexedItem<T>[];
  durationUs: number;
}

const VALID_IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.avif',
  '.bmp',
]);

const IGNORED_PATTERNS = [
  '__macosx',
  '.ds_store',
  'thumbs.db',
  'desktop.ini',
  'comicinfo.xml',
];

/**
 * Filtra entradas válidas de imagem, descartando arquivos ocultos ou de sistema operacional.
 */
export function isValidImageEntry(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').trim();
  if (!normalized || normalized.endsWith('/')) return false;

  const parts = normalized.split('/');
  for (const part of parts) {
    if (!part) continue;
    const lowerPart = part.toLowerCase();
    if (part.startsWith('.') || IGNORED_PATTERNS.includes(lowerPart)) {
      return false;
    }
  }

  const fileName = parts[parts.length - 1].toLowerCase();
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0) return false;

  const ext = fileName.slice(dotIndex);
  return VALID_IMAGE_EXTENSIONS.has(ext);
}

/**
 * Extrai a chave estruturada (Transformada de Schwartz / Key Extraction) em passo único O(N).
 * Divide uma única vez a string em segmentos alternados de Texto (normalizado) e Número (BigInt primitivo).
 */
export function extractSchwartzKey(inputPath: string): SchwartzSortKey {
  const normalized = inputPath.replace(/\\/g, '/');
  const segments: KeySegment[] = [];
  const previewParts: string[] = [];

  let i = 0;
  const len = normalized.length;

  while (i < len) {
    const code = normalized.charCodeAt(i);
    const isDigit = code >= 48 && code <= 57;

    if (isDigit) {
      let numStart = i;
      while (i < len) {
        const c = normalized.charCodeAt(i);
        if (c >= 48 && c <= 57) {
          i++;
        } else {
          break;
        }
      }
      const rawDigits = normalized.slice(numStart, i);
      const numericValue = BigInt(rawDigits);
      segments.push({ kind: 'num', value: numericValue });
      previewParts.push(`#${numericValue.toString()}`);
    } else {
      let textStart = i;
      while (i < len) {
        const c = normalized.charCodeAt(i);
        if (c >= 48 && c <= 57) {
          break;
        }
        i++;
      }
      const rawText = normalized.slice(textStart, i).toLowerCase();
      segments.push({ kind: 'text', value: rawText });
      previewParts.push(`"${rawText}"`);
    }
  }

  return {
    rawName: inputPath,
    segments,
    formattedKey: `[${previewParts.join(', ')}]`,
  };
}

/**
 * Compara duas chaves pré-extraídas sem nenhum regex ou parsing de string adicional.
 */
export function compareSchwartzKeys(a: SchwartzSortKey, b: SchwartzSortKey): number {
  const lenA = a.segments.length;
  const lenB = b.segments.length;
  const minLen = lenA < lenB ? lenA : lenB;

  for (let i = 0; i < minLen; i++) {
    const segA = a.segments[i];
    const segB = b.segments[i];

    if (segA.kind === 'num' && segB.kind === 'num') {
      if (segA.value < segB.value) return -1;
      if (segA.value > segB.value) return 1;
    } else if (segA.kind === 'text' && segB.kind === 'text') {
      if (segA.value < segB.value) return -1;
      if (segA.value > segB.value) return 1;
    } else {
      // Números vêm antes de texto caso estejam na mesma posição estrutural
      return segA.kind === 'num' ? -1 : 1;
    }
  }

  if (lenA !== lenB) {
    return lenA - lenB;
  }

  // Desempate determinístico pelo nome original (ex: "01.jpg" vs "1.jpg")
  return a.rawName < b.rawName ? -1 : a.rawName > b.rawName ? 1 : 0;
}

/**
 * Executa a Transformada de Schwartz completa:
 * 1. Map O(N): Extrai chave estruturada única vez para cada item
 * 2. Sort O(N log N): Ordena comparando apenas primitivas pré-extraídas
 * 3. Unmap O(N): Projeta a lista ordenada final
 */
export function schwartzNaturalSort<T>(
  items: T[],
  selector: (item: T) => string
): SchwartzSortResult<T> {
  const t0 = performance.now();

  // Passo 1: Key Extraction O(N)
  const indexed: SchwartzIndexedItem<T>[] = new Array(items.length);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    indexed[i] = {
      item,
      key: extractSchwartzKey(selector(item)),
    };
  }

  // Passo 2: Ordenação por tuplas primitivas
  indexed.sort((a, b) => compareSchwartzKeys(a.key, b.key));

  // Passo 3: Projeção de saída
  const sorted: T[] = new Array(indexed.length);
  for (let i = 0; i < indexed.length; i++) {
    sorted[i] = indexed[i].item;
  }

  const t1 = performance.now();
  const durationUs = Math.max(1, Math.round((t1 - t0) * 1000));

  return {
    sorted,
    indexed,
    durationUs,
  };
}

/**
 * Gera o nome padronizado com Zero-Padding (ex: 001.jpg, 002.jpg) ajustado ao total de páginas.
 */
export function formatZeroPaddedPageName(
  zeroBasedIndex: number,
  totalPages: number,
  originalName: string
): string {
  const digits = Math.max(3, String(totalPages).length);
  const pageNumber = String(zeroBasedIndex + 1).padStart(digits, '0');
  const dotIdx = originalName.lastIndexOf('.');
  const ext = dotIdx !== -1 ? originalName.slice(dotIdx).toLowerCase() : '.jpg';
  return `${pageNumber}${ext}`;
}
