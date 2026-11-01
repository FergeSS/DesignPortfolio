import { setTimeout as pause } from 'node:timers/promises';

const API = 'https://cloud-api.yandex.net/v1/disk';
export class AdminError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function component(value) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 180 || /[\\/\u0000-\u001f\u007f]/.test(value) || value.startsWith('.')) throw new AdminError('Недопустимое имя папки или файла.');
  return value;
}
export function diskRoot(value) {
  const root = String(value || '').replace(/^disk:/, '').replace(/\/+$/, '');
  if (!root.startsWith('/') || root === '/') throw new AdminError('Укажи путь к папке портфолио, например /РаботыСайт.');
  root.slice(1).split('/').forEach(component);
  return `disk:${root}`;
}
export const child = (root, ...names) => root.replace(/\/$/, '') + '/' + names.map(component).join('/');

function trustedUrl(value, operation = false) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname.endsWith('.yandex.net') || url.hostname.endsWith('.yandex.ru')) || (operation && (url.hostname !== 'cloud-api.yandex.net' || !url.pathname.startsWith('/v1/disk/operations/')))) throw new AdminError('Диск вернул неподходящую ссылку.', 502);
  return url;
}
export class WritableDisk {
  constructor(token, { fetchImpl = fetch, sleep = pause } = {}) {
    if (typeof token !== 'string' || !token || /\s/.test(token) || token.length > 8192) throw new AdminError('Проверь OAuth-токен.');
    this.token = token; this.fetch = fetchImpl; this.sleep = sleep;
  }
  async request(endpoint, params = {}, method = 'GET') {
    const url = new URL(API + endpoint);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    let response;
    try { response = await this.fetch(url, { method, headers: { Authorization: `OAuth ${this.token}` }, redirect: 'error', signal: AbortSignal.timeout(90000) }); }
    catch { throw new AdminError('Нет соединения с Диском. Попробуй ещё раз.', 502); }
    if (!response.ok) {
      const messages = { 401: 'Токен Диска недействителен. Подключи Диск заново.', 403: 'Нет доступа. Нужны разрешения на чтение и запись Диска.', 404: 'Файл или папка не найдены на Диске.', 409: 'Такое имя уже занято. Обнови список или выбери другое.', 423: 'Диск занят другой операцией. Попробуй ещё раз.', 429: 'Диск временно ограничил запросы. Подожди немного.', 507: 'На Диске закончилось свободное место.' };
      throw new AdminError(messages[response.status] || `Диск не выполнил запрос (HTTP ${response.status}).`, response.status);
    }
    if (response.status === 204) return {};
    const data = await response.json();
    if (response.status === 202 && data.href) {
      const operation = trustedUrl(data.href, true);
      for (let attempt = 0; attempt < 60; attempt++) {
        await this.sleep(1000);
        const poll = await this.fetch(operation, { headers: { Authorization: `OAuth ${this.token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
        if (!poll.ok) throw new AdminError('Не удалось проверить операцию на Диске. Обнови список перед повтором.', 502);
        const result = await poll.json();
        if (result.status === 'success') return result;
        if (result.status === 'failed') throw new AdminError('Диск не завершил операцию. Обнови список.', 502);
      }
      throw new AdminError('Операция ещё выполняется на Диске. Обнови список позднее.', 504);
    }
    return data;
  }
  resource(path, params = {}) { return this.request('/resources', { path, ...params }); }
  async list(path) {
    const items = []; let offset = 0; let name;
    for (;;) {
      const page = await this.resource(path, { limit: 100, offset, preview_size: 'M', preview_crop: false });
      if (page.type !== 'dir' || !page._embedded) throw new AdminError('Ожидалась папка на Диске.');
      name = page.name; const batch = page._embedded.items; items.push(...batch); offset += batch.length;
      if (offset >= page._embedded.total) return { name, items };
      if (!batch.length) throw new AdminError('Диск вернул неполный список.', 502);
    }
  }
  async download(path, maxBytes = 1024 * 1024) {
    const { href } = await this.request('/resources/download', { path });
    const response = await this.fetch(trustedUrl(href), { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new AdminError('Не удалось прочитать описание.', 502);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > maxBytes) throw new AdminError('Описание превышает 1 МБ.'); chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  async upload(path, bytes, overwrite = false) {
    const { href } = await this.request('/resources/upload', { path, overwrite });
    const response = await this.fetch(trustedUrl(href), { method: 'PUT', body: bytes, redirect: 'error', signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new AdminError(`Не удалось загрузить файл (HTTP ${response.status}).`, response.status);
  }
  mkdir(path) { return this.request('/resources', { path }, 'PUT'); }
  move(from, path, overwrite = false) { return this.request('/resources/move', { from, path, overwrite }, 'POST'); }
  trash(path) { return this.request('/resources', { path, permanently: false }, 'DELETE'); }
}
