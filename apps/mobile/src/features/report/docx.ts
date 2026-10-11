import { strToU8, zipSync } from 'fflate';

import type { ReportTable } from '../../domain/report';
import type { HtmlLabels } from './html';

/**
 * Writes a ReportTable as a Word document: the expense table, the claim lines, then one
 * block per receipt (photo, or what was entered when there is none) with the same tags as
 * the table, and the lost-receipt statements. Hand-written WordprocessingML zipped with
 * fflate, so it runs the same on phones and the web.
 */

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const NAVY = '1F3A5F';
const RED = 'B42318';
const EMU_PER_CM = 360_000;

interface Run { text: string; bold?: boolean; size?: number; color?: string }

const run = ({ text, bold, size, color }: Run) =>
  `<w:r><w:rPr>${bold ? '<w:b/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}${size ? `<w:sz w:val="${size * 2}"/>` : ''}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;

const para = (runs: Run[] | string, opts: { align?: 'right' | 'center'; before?: number; after?: number; pageBreak?: boolean } = {}) => {
  const list = typeof runs === 'string' ? [{ text: runs }] : runs;
  const ppr = [
    opts.pageBreak ? '<w:pageBreakBefore/>' : '',
    `<w:spacing w:before="${opts.before ?? 0}" w:after="${opts.after ?? 80}"/>`,
    opts.align ? `<w:jc w:val="${opts.align}"/>` : '',
  ].join('');
  return `<w:p><w:pPr>${ppr}</w:pPr>${list.map(run).join('')}</w:p>`;
};

const cell = (content: Run[] | string, opts: { fill?: string; align?: 'right'; span?: number; width?: number } = {}) =>
  `<w:tc><w:tcPr>${opts.width ? `<w:tcW w:w="${opts.width}" w:type="dxa"/>` : ''}${opts.span && opts.span > 1 ? `<w:gridSpan w:val="${opts.span}"/>` : ''}${opts.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${opts.fill}"/>` : ''}</w:tcPr>${para(content, { align: opts.align, after: 0 })}</w:tc>`;

// Usable width of a landscape A4 page with the margins below, in twentieths of a point.
const PAGE_WIDTH = 15_138;

/** A table; Word and LibreOffice both need the column widths up front to lay it out. */
const grid = (rows: string[], widths: number[], border = 'C9CED6') =>
  `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="${border}"/>`).join('')}</w:tblBorders>
    <w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>
    <w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.map((r) => `<w:tr>${r}</w:tr>`).join('')}</w:tbl>`;

/** Pixel size of a JPEG or PNG, so the picture keeps its shape in Word. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1]!;
      const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
      // Start-of-frame markers carry the size; 0xC4, 0xC8 and 0xCC share the range but do not.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (bytes[i + 5]! << 8) | bytes[i + 6]!, width: (bytes[i + 7]! << 8) | bytes[i + 8]! };
      }
      i += 2 + length;
    }
  }
  return null;
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A data URI's bytes and extension; null for anything Word cannot embed. */
function decodeImage(uri: string | null | undefined): { bytes: Uint8Array; ext: 'jpeg' | 'png' } | null {
  const m = uri?.match(/^data:image\/(jpeg|jpg|png);base64,(.+)$/);
  if (!m) return null;
  try {
    return { bytes: fromBase64(m[2]!), ext: m[1] === 'png' ? 'png' : 'jpeg' };
  } catch {
    return null;
  }
}

function picture(rid: string, id: number, size: { width: number; height: number } | null) {
  const maxW = 9 * EMU_PER_CM;
  const maxH = 12 * EMU_PER_CM;
  const ratio = size && size.width > 0 ? size.height / size.width : 4 / 3;
  let cx = maxW;
  let cy = Math.round(maxW * ratio);
  if (cy > maxH) {
    cy = maxH;
    cx = Math.round(maxH / ratio);
  }
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>
<wp:docPr id="${id}" name="Receipt ${id}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="receipt-${id}"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

export function reportToDocx(table: ReportTable, images: Record<string, string | null>, labels: HtmlLabels): Uint8Array {
  const media: Record<string, Uint8Array> = {};
  const rels: string[] = [];
  const body: string[] = [];
  const numeric = (i: number) => table.sections.some((s) => s.rows.some((r) => r[i]?.number !== undefined));
  const span = table.headers.length;
  const at = Math.max(1, Math.min(table.totalColumn, span - 1));
  const tail = (n: number) => Array.from({ length: n }, () => cell('')).join('');
  const noPhotoTags = new Set(table.attachments.filter((a) => a.missing).flatMap((a) => a.tags));

  body.push(para([{ text: table.title, bold: true, size: 18, color: NAVY }], { after: 40 }));
  body.push(para([{ text: `${table.period} · ${table.baseCurrency}`, color: '5B6470' }]));
  body.push(para([{ text: `${labels.total}: `, bold: true }, { text: table.total, bold: true, size: 13, color: NAVY }], { after: 200 }));

  const rows: string[] = [table.headers.map((h, i) => cell([{ text: h, bold: true, size: 9 }], { fill: 'E8EDF4', align: numeric(i) ? 'right' : undefined })).join('')];
  for (const s of table.sections) {
    if (s.title) rows.push(cell([{ text: s.title, bold: true }], { span, fill: 'F6F7F9' }));
    for (const r of s.rows) {
      rows.push(r.map((c, i) => (i === 0
        ? cell([{ text: c.text, bold: true, color: noPhotoTags.has(c.text) ? RED : NAVY }])
        : cell([{ text: c.text, size: 9 }], { align: numeric(i) ? 'right' : undefined }))).join(''));
    }
    if (s.title) rows.push(cell([{ text: labels.subtotal, bold: true }], { span: at }) + cell([{ text: s.subtotal, bold: true }], { align: 'right' }) + tail(span - at - 1));
  }
  rows.push(cell([{ text: labels.total, bold: true }], { span: at, fill: 'E8EDF4' }) + cell([{ text: table.total, bold: true }], { align: 'right', fill: 'E8EDF4' }) + tail(span - at - 1));
  // The tag column is narrow; the rest share the page.
  const tagWidth = 900;
  const rest = Math.floor((PAGE_WIDTH - tagWidth) / Math.max(span - 1, 1));
  body.push(grid(rows, [tagWidth, ...Array.from({ length: span - 1 }, () => rest)]));

  if (table.claim.length > 1) {
    body.push(para('', { after: 120 }));
    body.push(grid(table.claim.map((l) => cell([{ text: l.label, bold: l.strong }]) + cell([{ text: l.text, bold: l.strong }], { align: 'right' })), [5000, 3000]));
  }
  body.push(para([{ text: labels.generated, size: 8, color: '8A929C' }], { before: 120 }));

  if (table.attachments.length) {
    const photos = table.attachments.filter((a) => a.receiptId).length;
    body.push(para([{ text: labels.receipts, bold: true, size: 14, color: NAVY }], { pageBreak: true }));
    body.push(para([{ text: labels.receiptsHint(photos, table.attachments.length - photos), color: '5B6470' }], { after: 160 }));
    table.attachments.forEach((a, n) => {
      const image = decodeImage(a.receiptId ? images[a.receiptId] : null);
      const color = image ? NAVY : RED;
      body.push(para([
        { text: `${a.tags.join(' ')}  `, bold: true, size: 13, color },
        { text: `${a.date} · ${a.merchant}`, bold: true },
        { text: `   ${a.category} · ${a.amount}`, color: '5B6470' },
      ], { before: n ? 240 : 0, after: 60 }));
      if (image) {
        const rid = `rIdImg${n + 1}`;
        const name = `receipt${n + 1}.${image.ext}`;
        media[`word/media/${name}`] = image.bytes;
        rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
        body.push(picture(rid, n + 1, imageSize(image.bytes)));
        return;
      }
      body.push(para([{ text: a.missing ? labels.noPhoto[a.missing] : labels.noPhoto.failed, bold: true, color: RED }], { after: 40 }));
      if (a.details.length) {
        body.push(grid(a.details.map((d) => cell([{ text: d.label, size: 9, color: '5B6470' }], { width: 2400, fill: 'FDF2F2' }) + cell([{ text: d.value, size: 9 }])), [2400, 6600], 'E3A0A0'));
      }
    });
  }

  const x = labels.affidavit;
  for (const f of table.affidavits) {
    body.push(para([{ text: `${f.tag}  `, bold: true, size: 14, color: NAVY }, { text: x.title, bold: true, size: 14, color: NAVY }], { pageBreak: true, after: 160 }));
    body.push(grid([[x.date, f.date], [x.merchant, f.merchant], [x.amount, f.amount], [x.reason, f.reason]]
      .map(([k, v]) => cell([{ text: k!, bold: true }], { width: 2800, fill: 'F6F7F9' }) + cell(v!)), [2800, 9000]));
    body.push(para(x.statement, { before: 240, after: 240 }));
    body.push(para([{ text: `${x.signedAt}: ${f.signedAt.slice(0, 10)}     ${x.signer}: ` }, { text: f.signer, bold: true }], { align: 'right' }));
  }

  // Landscape A4 so wide tables fit.
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>${body.join('\n')}
<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850" w:header="400" w:footer="400" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`),
    'word/document.xml': strToU8(document),
    ...media,
  };
  return zipSync(files);
}
