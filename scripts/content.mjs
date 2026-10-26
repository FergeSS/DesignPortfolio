import { createHash } from 'node:crypto';
import { readWordText } from './word.mjs';

export const imagePattern = /\.(jpe?g|png|webp|gif|avif)$/i;
export const natural = (a, b) => a.localeCompare(b, 'ru', { numeric: true });
export const hash = (value) => createHash('sha256').update(value).digest('hex');

export function decodeInfo(bytes, file, warnings = []) {
  if (bytes.subarray(0, 6).toString('ascii').startsWith('{\\rtf')) {
    throw new Error(`${file}: это RTF. Сохраните обычный TXT в UTF-8 или документ DOCX.`);
  }
  if (bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4]))) {
    warnings.push(`${file}: прочитан документ Word. Для основного формата сохраните обычный TXT в UTF-8.`);
    return readWordText(bytes);
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) throw new Error('NUL');
    return text;
  } catch {
    throw new Error(`${file}: сохраните info.txt в кодировке UTF-8.`);
  }
}

export function parseInfo(text, folder) {
  const result = { title: folder, category: '', year: '', order: 9999, description: '', slug: '', published: true };
  const keys = { название: 'title', категория: 'category', год: 'year', порядок: 'order', адрес: 'slug', slug: 'slug', публиковать: 'published' };
  const seen = new Set();
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  if (!lines.some((line) => /^(название|категория|год|порядок|адрес|slug|публиковать|описание)\s*:/i.test(line.trim()))) {
    result.description = lines.join('\n').trim();
    return result;
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const pair = /^([^:]+):\s*(.*)$/.exec(line);
    if (pair?.[1].trim().toLowerCase() === 'описание') {
      result.description = [pair[2], ...lines.slice(i + 1)].join('\n').trim();
      break;
    }
    const key = pair && keys[pair[1].trim().toLowerCase()];
    if (!key) throw new Error(`${folder}/info.txt: неизвестное поле «${line}». Текст должен идти после «Описание:».`);
    if (seen.has(key)) throw new Error(`${folder}/info.txt: поле «${pair[1]}» повторяется.`);
    seen.add(key);
    result[key] = pair[2].trim();
  }
  if (!result.title) throw new Error(`${folder}/info.txt: пустое название.`);
  if (!/^-?\d+$/.test(String(result.order)) || !Number.isSafeInteger(Number(result.order))) throw new Error(`${folder}/info.txt: «Порядок» должен быть целым числом.`);
  result.order = Number(result.order);
  if (result.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result.slug)) throw new Error(`${folder}/info.txt: «Адрес» — латинские буквы в нижнем регистре, цифры и дефисы.`);
  if (typeof result.published === 'string') {
    const value = result.published.toLowerCase();
    if (!['да', 'нет', 'true', 'false'].includes(value)) throw new Error(`${folder}/info.txt: «Публиковать» — да или нет.`);
    result.published = ['да', 'true'].includes(value);
  }
  return result;
}

export function defaultSlug(path) {
  return `project-${hash(path).slice(0, 12)}`;
}

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
