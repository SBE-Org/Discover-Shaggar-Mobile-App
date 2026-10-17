// CSV reading and writing (RFC 4180 quoting, comma, semicolon or tab separated).

export function parseCsv(text) {
  const t = String(text || '').replace(/^﻿/, '');
  const firstLine = t.split(/\r?\n/, 1)[0] || '';
  const sep = firstLine.includes('\t') ? '\t' : (!firstLine.includes(',') && firstLine.includes(';')) ? ';' : ',';
  const rows = [];
  let row = [], cur = '', quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else quoted = false; }
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const cell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
  return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export const toCsv = (rows) => '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
