import type { ReportTable } from '../../domain/report';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface HtmlLabels {
  subtotal: string;
  total: string;
  receipts: string;
  receiptNo: (n: number) => string;
  generated: string;
  affidavit: {
    title: string; date: string; merchant: string; amount: string; reason: string; statement: string; signer: string; signedAt: string;
  };
  /** Summary chart titles; the summary is left out when absent */
  byCategory?: string;
  byDay?: string;
}

// Chart colours that read well in print, one per category in order.
const PALETTE = ['#1F3A5F', '#3E7CB1', '#81A4CD', '#F2A65A', '#E86A58', '#7FB685', '#B39CD0', '#C9CED6'];

/** Print-ready HTML for the PDF report; receipt photos are data URIs. */
export function reportToHtml(table: ReportTable, images: Record<string, string | null>, labels: HtmlLabels): string {
  const numeric = (i: number) => table.sections.some((s) => s.rows.some((r) => r[i]?.number !== undefined));
  const align = table.headers.map((_, i) => (numeric(i) ? ' class="num"' : ''));
  const span = table.headers.length;
  // Label across the columns before the total; blank cells after it for any extra columns.
  const at = Math.max(1, Math.min(table.totalColumn, span - 1));
  const tail = '<td></td>'.repeat(span - at - 1);

  const body = table.sections.map((s) => `
    ${s.title ? `<tr class="group"><td colspan="${span}">${esc(s.title)}</td></tr>` : ''}
    ${s.rows.map((r) => `<tr>${r.map((c, i) => `<td${align[i]}>${esc(c.text)}</td>`).join('')}</tr>`).join('')}
    ${s.title ? `<tr class="sub"><td colspan="${at}">${esc(labels.subtotal)}</td><td class="num">${esc(s.subtotal)}</td>${tail}</tr>` : ''}
  `).join('');

  const cats = table.summary.byCategory;
  const days = table.summary.byDay;
  const maxDay = Math.max(...days.map((d) => d.number), 0);
  const summary = labels.byCategory && labels.byDay && cats.length
    ? `<section class="summary">
    <div class="panel"><h2>${esc(labels.byCategory)}</h2>
      <div class="stack">${cats.map((c, i) => `<span style="width:${c.share}%;background:${PALETTE[i % PALETTE.length]}"></span>`).join('')}</div>
      <table class="legend">${cats.map((c, i) => `<tr><td><i style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(c.label)}</td><td class="num">${c.share}%</td><td class="num">${esc(c.text)}</td></tr>`).join('')}</table>
    </div>
    <div class="panel"><h2>${esc(labels.byDay)}</h2>
      <div class="bars">${days.map((d) => `<div class="col"><div class="bar" style="height:${maxDay ? Math.max((d.number / maxDay) * 100, 2) : 0}%"></div><small>${esc(d.date.slice(5).replace('-', '/'))}</small></div>`).join('')}</div>
    </div>
  </section>`
    : '';

  const appendix = table.receipts.filter((r) => images[r.receiptId]);
  const receiptPages = appendix.length
    ? `<section class="receipts"><h2>${esc(labels.receipts)}</h2><div class="grid">${appendix
        .map((r) => `<figure><img src="${images[r.receiptId]}"/><figcaption>${esc(labels.receiptNo(r.no))}</figcaption></figure>`)
        .join('')}</div></section>`
    : '';

  // Shown only when it says more than the grand total already does.
  const claim = table.claim.length > 1
    ? `<table class="claim">${table.claim
        .map((l) => `<tr${l.strong ? ' class="strong"' : ''}><td>${esc(l.label)}</td><td class="num">${esc(l.text)}</td></tr>`)
        .join('')}</table>`
    : '';

  const a = labels.affidavit;
  const affidavits = table.affidavits
    .map((x) => `<section class="affidavit"><h2>${esc(a.title)}</h2><table>
      <tr><th>${esc(a.date)}</th><td>${esc(x.date)}</td></tr>
      <tr><th>${esc(a.merchant)}</th><td>${esc(x.merchant)}</td></tr>
      <tr><th>${esc(a.amount)}</th><td>${esc(x.amount)}</td></tr>
      <tr><th>${esc(a.reason)}</th><td>${esc(x.reason)}</td></tr>
    </table><p>${esc(a.statement)}</p>
    <div class="sign"><span>${esc(a.signedAt)}: ${esc(x.signedAt.slice(0, 10))}</span><span>${esc(a.signer)}: <strong>${esc(x.signer)}</strong></span></div></section>`)
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(table.title)}</title><style>
  @page { margin: 16mm 14mm; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, 'Noto Sans KR', sans-serif; color: #1a1d21; font-size: 10.5pt; }
  header { border-bottom: 2px solid #1F3A5F; padding-bottom: 8px; margin-bottom: 14px; }
  h1 { font-size: 18pt; margin: 0 0 4px; color: #1F3A5F; }
  .meta { color: #5b6470; }
  .total { float: right; text-align: right; }
  .total strong { display: block; font-size: 16pt; color: #1F3A5F; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #E8EDF4; text-align: left; padding: 6px 8px; font-size: 9pt; border-bottom: 1px solid #1F3A5F; }
  td { padding: 5px 8px; border-bottom: 1px solid #e3e6ea; vertical-align: top; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.group td { font-weight: 600; background: #f6f7f9; padding-top: 8px; }
  tr.sub td { font-weight: 600; border-bottom: 1px solid #c9ced6; }
  tr.grand td { font-weight: 700; font-size: 11.5pt; border-top: 2px solid #1F3A5F; border-bottom: none; }
  .summary { display: flex; gap: 16px; margin-bottom: 16px; break-inside: avoid; }
  .panel { flex: 1; border: 1px solid #e3e6ea; border-radius: 6px; padding: 10px 12px; }
  .panel h2 { margin: 0 0 8px; font-size: 11pt; }
  .stack { display: flex; height: 12px; border-radius: 6px; overflow: hidden; background: #e3e6ea; margin-bottom: 6px; }
  .legend td { border: none; padding: 2px 4px; font-size: 9pt; }
  .legend i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 6px; }
  .bars { display: flex; align-items: flex-end; gap: 4px; height: 90px; }
  .col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
  .bar { width: 70%; background: #3E7CB1; border-radius: 3px 3px 0 0; }
  .col small { font-size: 7pt; color: #5b6470; margin-top: 2px; }
  .receipts { page-break-before: always; }
  h2 { font-size: 13pt; color: #1F3A5F; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  figure { margin: 0; break-inside: avoid; border: 1px solid #e3e6ea; padding: 6px; }
  figure img { width: 100%; max-height: 110mm; object-fit: contain; }
  figcaption { text-align: center; font-size: 9pt; color: #5b6470; margin-top: 4px; }
  footer { margin-top: 14px; color: #8a929c; font-size: 8pt; }
  table.claim { width: 60%; margin: 16px 0 0 auto; }
  table.claim td { border-bottom: 1px solid #e3e6ea; }
  table.claim tr.strong td { font-weight: 700; font-size: 12pt; color: #1F3A5F; border-top: 2px solid #1F3A5F; }
  .affidavit { page-break-before: always; }
  .affidavit table th { width: 28%; background: #f6f7f9; border-bottom: 1px solid #e3e6ea; }
  .affidavit p { margin: 18px 0; line-height: 1.6; }
  .sign { display: flex; justify-content: space-between; margin-top: 28px; }
  </style></head><body>
  <header>
    <div class="total">${esc(labels.total)}<strong>${esc(table.total)}</strong></div>
    <h1>${esc(table.title)}</h1>
    <div class="meta">${esc(table.period)} · ${esc(table.baseCurrency)}</div>
  </header>
  ${summary}
  <table>
    <thead><tr>${table.headers.map((h, i) => `<th${align[i]}>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${body}
      <tr class="grand"><td colspan="${at}">${esc(labels.total)}</td><td class="num">${esc(table.total)}</td>${tail}</tr>
    </tbody>
  </table>
  ${claim}
  <footer>${esc(labels.generated)}</footer>
  ${receiptPages}
  ${affidavits}
  </body></html>`;
}
