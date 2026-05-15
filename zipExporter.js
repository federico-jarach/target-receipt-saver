/*
  Tiny ZIP writer using the STORE method (no compression).
  This avoids an external JSZip dependency and keeps the extension local-only.
*/
const TargetZipExporter = (() => {
  const encoder = new TextEncoder();

  function makeCrcTable() {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  }

  const crcTable = makeCrcTable();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { dosTime, dosDate };
  }

  function u16(value) {
    const bytes = new Uint8Array(2);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, value, true);
    return bytes;
  }

  function u32(value) {
    const bytes = new Uint8Array(4);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, value >>> 0, true);
    return bytes;
  }

  function concatArrays(arrays) {
    const total = arrays.reduce((sum, item) => sum + item.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const item of arrays) {
      out.set(item, offset);
      offset += item.length;
    }
    return out;
  }

  function encodeText(value) {
    return encoder.encode(String(value ?? ''));
  }

  function safeFilename(value, fallback = 'receipt') {
    const cleaned = String(value || fallback)
      .toLowerCase()
      .replace(/https?:\/\//g, '')
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100);
    return cleaned || fallback;
  }

  function escapeCsvCell(value) {
    const text = Array.isArray(value) ? value.join(' | ') : String(value ?? '');
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function makeCsv(rows, columns) {
    const lines = [columns.join(',')];
    for (const row of rows) {
      lines.push(columns.map((column) => escapeCsvCell(row[column])).join(','));
    }
    return `${lines.join('\n')}\n`;
  }

  function addZipFile(files, name, content) {
    files.push({
      name,
      bytes: content instanceof Uint8Array ? content : encodeText(content)
    });
  }

  function buildZip(files) {
    const parts = [];
    const centralParts = [];
    const { dosTime, dosDate } = dosDateTime();
    let offset = 0;

    for (const file of files) {
      const nameBytes = encodeText(file.name);
      const dataBytes = file.bytes;
      const crc = crc32(dataBytes);
      const localHeader = concatArrays([
        u32(0x04034b50),
        u16(20),
        u16(0x0800), // UTF-8 filename flag
        u16(0),
        u16(dosTime),
        u16(dosDate),
        u32(crc),
        u32(dataBytes.length),
        u32(dataBytes.length),
        u16(nameBytes.length),
        u16(0),
        nameBytes
      ]);

      parts.push(localHeader, dataBytes);

      const centralHeader = concatArrays([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(dosTime),
        u16(dosDate),
        u32(crc),
        u32(dataBytes.length),
        u32(dataBytes.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes
      ]);

      centralParts.push(centralHeader);
      offset += localHeader.length + dataBytes.length;
    }

    const centralOffset = offset;
    const centralDirectory = concatArrays(centralParts);
    const endRecord = concatArrays([
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(files.length),
      u16(files.length),
      u32(centralDirectory.length),
      u32(centralOffset),
      u16(0)
    ]);

    parts.push(centralDirectory, endRecord);
    return new Blob(parts, { type: 'application/zip' });
  }

  function buildExport(data) {
    const receipts = Array.isArray(data.receipts) ? data.receipts : [];
    const failures = Array.isArray(data.failures) ? data.failures : [];
    const files = [];
    const manifestRows = [];

    receipts.forEach((receipt, index) => {
      const safeId = safeFilename(receipt.order_number_guess || receipt.id || `receipt-${index + 1}`);
      const receiptFilename = `receipts/target_order_${String(index + 1).padStart(4, '0')}_${safeId}.html`;
      const rawFilename = `raw/target_order_${String(index + 1).padStart(4, '0')}_${safeId}.json`;

      addZipFile(files, receiptFilename, receipt.clean_html_snapshot || '<!doctype html><html><body>No HTML snapshot available.</body></html>');
      addZipFile(files, rawFilename, JSON.stringify(receipt, null, 2));

      manifestRows.push({
        index: index + 1,
        parent_order_index: receipt.parent_order_index || '',
        receipt_branch_index: receipt.receipt_branch_index || '',
        order_number_guess: receipt.order_number_guess || '',
        order_date_guess: receipt.order_date_guess || '',
        order_total_guess: receipt.order_total_guess || '',
        status_guess: receipt.status_guess || '',
        item_count_estimate: receipt.item_count_estimate || '',
        receipt_filename: receiptFilename,
        source_url: receipt.source_url || '',
        initial_order_url: receipt.initial_order_url || '',
        final_receipt_url: receipt.final_receipt_url || '',
        extracted_at: receipt.extracted_at || '',
        parser_warnings: Array.isArray(receipt.parser_warnings) ? receipt.parser_warnings.join(' | ') : ''
      });
    });

    const columns = [
      'index',
      'parent_order_index',
      'receipt_branch_index',
      'order_number_guess',
      'order_date_guess',
      'order_total_guess',
      'status_guess',
      'item_count_estimate',
      'receipt_filename',
      'source_url',
      'initial_order_url',
      'final_receipt_url',
      'extracted_at',
      'parser_warnings'
    ];

    addZipFile(files, 'manifest.csv', makeCsv(manifestRows, columns));
    addZipFile(files, 'manifest.json', JSON.stringify({
      exported_at: new Date().toISOString(),
      receipt_count: receipts.length,
      failure_count: failures.length,
      receipts: manifestRows
    }, null, 2));

    if (failures.length) {
      addZipFile(files, 'failures.json', JSON.stringify(failures, null, 2));
    }

    return buildZip(files);
  }

  function exportFilename() {
    const date = new Date().toISOString().slice(0, 10);
    return `target_receipts_${date}.zip`;
  }

  return {
    buildExport,
    exportFilename,
    safeFilename,
    makeCsv
  };
})();
