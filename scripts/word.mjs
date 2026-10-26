import { inflateRawSync } from 'node:zlib';

// Read only Word's main text part, without extracting arbitrary ZIP paths.
// Formatting, headers, footnotes, embedded objects and tracked changes are outside this import format.
export function readWordText(bytes) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw new Error('Повреждённый ZIP/DOCX.');
  let cursor = bytes.readUInt32LE(end + 16);
  const count = bytes.readUInt16LE(end + 10);
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Повреждённый каталог DOCX.');
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (name === 'word/document.xml') {
      if (size > 2 * 1024 * 1024) throw new Error('Слишком большой текст DOCX.');
      const offset = bytes.readUInt32LE(cursor + 42);
      if (offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50) throw new Error('Повреждённый DOCX.');
      const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
      if (start + compressedSize > bytes.length) throw new Error('Оборванный DOCX.');
      const compressed = bytes.subarray(start, start + compressedSize);
      const xmlBytes = method === 8 ? inflateRawSync(compressed, { maxOutputLength: 2 * 1024 * 1024 }) : method === 0 ? compressed : null;
      if (!xmlBytes || xmlBytes.length !== size) throw new Error('Неподдерживаемый или повреждённый DOCX.');
      const xml = new TextDecoder('utf-8', { fatal: true }).decode(xmlBytes);
      const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
      const decode = (value) => value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
        if (!entity.startsWith('#')) return entities[entity.toLowerCase()];
        return String.fromCodePoint(entity.toLowerCase().startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
      });
      return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<\/w:p>|<w:(?:br|cr)\b[^>]*\/>|<w:tab\b[^>]*\/>/g)].map((match) => match[1] !== undefined ? decode(match[1]) : match[0].startsWith('<w:tab') ? '\t' : '\n').join('').trim();
    }
    cursor += 46 + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
  }
  throw new Error('Это ZIP-архив, но не документ Word DOCX.');
}
