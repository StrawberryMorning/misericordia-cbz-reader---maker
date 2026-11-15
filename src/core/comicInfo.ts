export type ComicPageType =
  | 'FrontCover'
  | 'InnerCover'
  | 'Story'
  | 'DoublePage'
  | 'Advertisement'
  | 'BackCover';

export interface ComicInfoMetadata {
  title: string;
  series: string;
  number: string;
  volume: string;
  writer: string;
  penciller?: string;
  inker?: string;
  colorist?: string;
  letterer?: string;
  coverArtist?: string;
  publisher?: string;
  genre?: string;
  tags?: string;
  ageRating?: string;
  year?: string;
  month?: string;
  day?: string;
  web?: string;
  summary: string;
  manga: 'No' | 'YesAndRightToLeft';
  languageISO: string;
  pageCount: number;
}

export interface PageMetaEntry {
  index: number;
  byteSize: number;
  type?: ComicPageType;
  doublePage?: boolean;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function createEmptyComicInfo(pageCount = 0): ComicInfoMetadata {
  return {
    title: '',
    series: '',
    number: '',
    volume: '',
    writer: '',
    penciller: '',
    inker: '',
    colorist: '',
    letterer: '',
    coverArtist: '',
    publisher: '',
    genre: '',
    tags: '',
    ageRating: 'Everyone',
    year: '',
    month: '',
    day: '',
    web: '',
    summary: '',
    manga: 'No',
    languageISO: 'pt-BR',
    pageCount,
  };
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

  const pushTag = (tag: string, val?: string) => {
    if (val && val.trim()) {
      lines.push(`  <${tag}>${escapeXml(val.trim())}</${tag}>`);
    }
  };

  pushTag('Title', meta.title);
  pushTag('Series', meta.series);
  pushTag('Number', meta.number);
  pushTag('Volume', meta.volume);
  pushTag('Summary', meta.summary);
  pushTag('Year', meta.year);
  pushTag('Month', meta.month);
  pushTag('Day', meta.day);
  pushTag('Writer', meta.writer);
  pushTag('Penciller', meta.penciller);
  pushTag('Inker', meta.inker);
  pushTag('Colorist', meta.colorist);
  pushTag('Letterer', meta.letterer);
  pushTag('CoverArtist', meta.coverArtist);
  pushTag('Publisher', meta.publisher);
  pushTag('Genre', meta.genre);
  pushTag('Tags', meta.tags);
  pushTag('Web', meta.web);
  pushTag('AgeRating', meta.ageRating);
  pushTag('LanguageISO', meta.languageISO);

  lines.push(`  <PageCount>${meta.pageCount}</PageCount>`);
  lines.push(`  <Manga>${meta.manga}</Manga>`);

  if (pages.length > 0) {
    lines.push('  <Pages>');
    for (const p of pages) {
      const resolvedType = p.type ?? (p.index === 0 ? 'FrontCover' : 'Story');
      const typeAttr = resolvedType ? ` Type="${resolvedType}"` : '';
      const doubleAttr =
        p.doublePage || resolvedType === 'DoublePage'
          ? ' DoublePage="True"'
          : '';
      lines.push(
        `    <Page Image="${p.index}" ImageSize="${p.byteSize}"${typeAttr}${doubleAttr} />`
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
      penciller: getTag('Penciller'),
      inker: getTag('Inker'),
      colorist: getTag('Colorist'),
      letterer: getTag('Letterer'),
      coverArtist: getTag('CoverArtist'),
      publisher: getTag('Publisher'),
      genre: getTag('Genre'),
      tags: getTag('Tags'),
      ageRating: getTag('AgeRating') || 'Everyone',
      year: getTag('Year'),
      month: getTag('Month'),
      day: getTag('Day'),
      web: getTag('Web'),
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
