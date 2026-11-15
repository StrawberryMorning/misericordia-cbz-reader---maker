export interface ComicInfoMetadata {
  title: string;
  series: string;
  number: string;
  volume: string;
  writer: string;
  summary: string;
  manga: 'No' | 'YesAndRightToLeft';
  languageISO: string;
  pageCount: number;
}

export interface PageMetaEntry {
  index: number;
  byteSize: number;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Gera o conteúdo XML padronizado para ComicInfo.xml na raiz do pacote .cbz.
 */
export function buildComicInfoXml(
  meta: ComicInfoMetadata,
  pages: PageMetaEntry[] = []
): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
  ];

  if (meta.title.trim()) {
    lines.push(`  <Title>${escapeXml(meta.title.trim())}</Title>`);
  }
  if (meta.series.trim()) {
    lines.push(`  <Series>${escapeXml(meta.series.trim())}</Series>`);
  }
  if (meta.number.trim()) {
    lines.push(`  <Number>${escapeXml(meta.number.trim())}</Number>`);
  }
  if (meta.volume.trim()) {
    lines.push(`  <Volume>${escapeXml(meta.volume.trim())}</Volume>`);
  }
  if (meta.writer.trim()) {
    lines.push(`  <Writer>${escapeXml(meta.writer.trim())}</Writer>`);
  }
  if (meta.summary.trim()) {
    lines.push(`  <Summary>${escapeXml(meta.summary.trim())}</Summary>`);
  }
  if (meta.languageISO.trim()) {
    lines.push(`  <LanguageISO>${escapeXml(meta.languageISO.trim())}</LanguageISO>`);
  }

  lines.push(`  <PageCount>${meta.pageCount}</PageCount>`);
  lines.push(`  <Manga>${meta.manga}</Manga>`);

  if (pages.length > 0) {
    lines.push('  <Pages>');
    for (const p of pages) {
      const typeAttr = p.index === 0 ? ' Type="FrontCover"' : '';
      lines.push(
        `    <Page Image="${p.index}" ImageSize="${p.byteSize}"${typeAttr} />`
      );
    }
    lines.push('  </Pages>');
  }

  lines.push('</ComicInfo>');
  return lines.join('\n');
}

/**
 * Faz o parse de um ComicInfo.xml existente dentro do arquivo CBZ.
 */
export function parseComicInfoXml(xmlText: string): Partial<ComicInfoMetadata> {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');
    const getTag = (tag: string) =>
      doc.querySelector(tag)?.textContent?.trim() || '';

    const pageCountRaw = parseInt(getTag('PageCount'), 10);
    const mangaTag = getTag('Manga');

    return {
      title: getTag('Title'),
      series: getTag('Series'),
      number: getTag('Number'),
      volume: getTag('Volume'),
      writer: getTag('Writer'),
      summary: getTag('Summary'),
      languageISO: getTag('LanguageISO') || 'pt-BR',
      manga:
        mangaTag === 'Yes' || mangaTag === 'YesAndRightToLeft'
          ? 'YesAndRightToLeft'
          : 'No',
      pageCount: Number.isNaN(pageCountRaw) ? undefined : pageCountRaw,
    };
  } catch {
    return {};
  }
}
