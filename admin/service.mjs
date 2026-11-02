import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { toWebp, webpName, commitWebpImages } from './webp.mjs';
import { YandexDisk } from '../scripts/yandex.mjs';
import { decodeInfo, parseInfo, defaultSlug, imagePattern, preferWebpImages, webpImageOrder, natural, hash, validateImageOrder, galleryImages } from '../scripts/content.mjs';
import { AdminError, WritableDisk, component, child, diskRoot } from './disk.mjs';

const revision = (files) => hash(JSON.stringify(files.map((f) => [f.name, f.md5 || f.revision || f.modified || '', f.size || 0]).sort((a, b) => natural(a[0], b[0]))));
const shareKey = (value) => { try { return new URL(value).pathname.replace(/\/$/, '').split('/').at(-1); } catch { return ''; } };
export function serializeMetadata(input, folder) {
  const line = (value, label, max = 200) => {
    if (typeof value !== 'string' || /[\r\n\0]/.test(value) || value.length > max) throw new AdminError(`Проверь поле «${label}».`);
    return value.trim();
  };
  const title = line(input.title, 'Название');
  const category = line(input.category || '', 'Категория');
  const year = line(input.year || '', 'Год', 40);
  const slug = line(input.slug || '', 'Адрес');
  const order = Number(input.order);
  if (!title || !Number.isSafeInteger(order) || !String(input.order).trim() || typeof input.published !== 'boolean' || typeof input.description !== 'string' || input.description.length > 200000 || input.description.includes('\0')) throw new AdminError('Укажи название, целый порядок и корректное описание.');
  let imageOrder;
  try { imageOrder = validateImageOrder(input.imageOrder ?? []); } catch (error) { throw new AdminError(error.message); }
  const text = `Название: ${title}\nКатегория: ${category}\nГод: ${year}\nПорядок: ${order}\nАдрес: ${slug}\nПубликовать: ${input.published ? 'да' : 'нет'}\n${imageOrder.length ? `Порядок изображений: ${JSON.stringify(imageOrder)}\n` : ''}Описание:\n${input.description.trim()}\n`;
  try { parseInfo(text, folder); } catch (error) { throw new AdminError(error.message); }
  return text;
}
export function validateImage(name, bytes) {
  component(name);
  if (!imagePattern.test(name)) throw new AdminError('Поддерживаются PNG, JPG, WebP, GIF и AVIF.');
  const ext = name.split('.').at(-1).toLowerCase();
  const valid = ext === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : /jpe?g/.test(ext) ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : ext === 'gif' ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))
    : ext === 'webp' ? bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
    : bytes.subarray(4, 8).toString() === 'ftyp' && /avif|avis/.test(bytes.subarray(8, 40).toString('ascii'));
  if (!valid) throw new AdminError('Содержимое файла не соответствует расширению. Выбери изображение того же формата.');
}

export class AdminService {
  constructor({ root, config, publicDisk, writerFactory = (token) => new WritableDisk(token) }) {
    this.root = root; this.config = config; this.publicDisk = publicDisk || new YandexDisk(config.publicUrl);
    this.writerFactory = writerFactory; this.settings = null; this.verified = 0;
    this.queue = Promise.resolve(); this.pendingWrites = 0; this.previews = new Map();
  }
  get settingsPath() { return resolve(this.root, '.cache/admin/settings.json'); }
  async init() {
    try { this.settings = JSON.parse(await readFile(this.settingsPath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new AdminError('Локальные настройки повреждены. Переименуй .cache/admin/settings.json и подключи Диск заново.', 500); }
    if (this.settings) { this.settings.root = diskRoot(this.settings.root); this.writer = this.writerFactory(this.settings.token); }
    return this;
  }
  status() { return { connected: Boolean(this.writer), root: this.settings?.root || 'disk:/РаботыСайт', publicUrl: this.config.publicUrl, pendingWrites: this.pendingWrites }; }
  exclusive(task) {
    this.pendingWrites++;
    const result = this.queue.then(task);
    this.queue = result.catch(() => {}).finally(() => { this.pendingWrites--; });
    return result;
  }
  async verify(writer, root) {
    const resource = await writer.resource(root, { fields: 'name,type,public_url,public_key' });
    const expected = shareKey(this.config.publicUrl);
    if (resource.type !== 'dir' || !expected || ![resource.public_url, resource.public_key].some((url) => shareKey(url) === expected)) throw new AdminError('Эта папка не совпадает с публичной папкой портфолио. Проверь путь на Диске.');
  }
  async connect({ token, root }) {
    root = diskRoot(root);
    token = token?.trim() || this.settings?.token;
    const writer = this.writerFactory(token);
    await this.verify(writer, root);
    const directory = resolve(this.root, '.cache/admin');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(this.settingsPath + '.tmp', JSON.stringify({ token, root }), { mode: 0o600 });
    await rename(this.settingsPath + '.tmp', this.settingsPath);
    this.settings = { token, root }; this.writer = writer; this.verified = Date.now(); this.previews.clear();
    return this.status();
  }
  async writable() {
    if (!this.writer) throw new AdminError('Сначала подключи Диск в настройках.', 403);
    if (Date.now() - this.verified > 30000) { await this.verify(this.writer, this.settings.root); this.verified = Date.now(); }
    return this.writer;
  }
  context() { return this.writer ? { disk: this.writer, base: this.settings.root } : { disk: this.publicDisk, base: this.config.sourcePath || '/' }; }
  allowedFolder(folder) {
    component(folder);
    if ((this.config.ignoredFolders || []).some((value) => value.toLowerCase() === folder.toLowerCase())) throw new AdminError('Эта папка исключена из портфолио.');
    return folder;
  }
  async project(folder, context = this.context()) {
    this.allowedFolder(folder);
    const { disk, base } = context;
    const path = child(base, folder);
    const { items } = await disk.list(path);
    const files = items.filter((item) => item.type === 'file');
    const infos = files.filter((item) => /^info\.(txt|docx)$/i.test(item.name));
    let metadata = parseInfo('', folder); let problem = ''; let metadataUnavailable = false;
    if (infos[0]) {
      let bytes;
      try { bytes = await disk.download(child(path, infos[0].name), 1024 * 1024); }
      catch {
        metadataUnavailable = true;
        problem = 'Не удалось загрузить описание с Диска. Нажми «Обновить», чтобы повторить. Редактирование временно отключено; исходный файл не изменён.';
      }
      if (bytes) {
        try { metadata = parseInfo(decodeInfo(bytes, infos[0].name), folder); }
        catch (error) { problem = `Описание требует исправления: ${error.message}`; }
      }
    }
    if (!problem && infos.length > 1) problem = 'Найдено несколько описаний. При сохранении останется один info.txt, предыдущие копии будут сохранены локально.';
    const slug = metadata.slug || defaultSlug(child(this.config.sourcePath || '/', folder));
    const images = preferWebpImages(files).sort((a, b) => natural(a.name, b.name)).map((item) => ({ name: item.name, size: item.size || 0, revision: String(item.md5 || item.modified || ''), thumbnail: '/api/thumbnail?' + new URLSearchParams({ folder, name: item.name, revision: String(item.md5 || item.modified || '') }) }));
    metadata.imageOrder = webpImageOrder(images, metadata.imageOrder);
    const cover = images.find((item) => /^cover\./i.test(item.name))?.name || images[0]?.name || '';
    return { ...metadata, slug, folder, images: galleryImages(images, metadata.imageOrder, cover), cover, problem, metadataUnavailable, version: metadataUnavailable ? null : revision(files), hasInfo: Boolean(infos.length) };
  }
  async projects() {
    const context = this.context();
    const source = await context.disk.list(context.base);
    const folders = source.items.filter((item) => item.type === 'dir' && !item.name.startsWith('.') && !(this.config.ignoredFolders || []).some((name) => name.toLowerCase() === item.name.toLowerCase()));
    const projects = [];
    for (const folder of folders) projects.push(await this.project(folder.name, context));
    return projects.sort((a, b) => a.order - b.order || natural(a.title, b.title));
  }
  async current(folder, expected) {
    await this.writable();
    const project = await this.project(folder);
    if (project.metadataUnavailable) throw new AdminError('Описание работы не загружено с Диска. Нажми «Обновить» перед внесением изменений.', 502);
    if (!expected || project.version !== expected) throw new AdminError('Работа изменилась на Диске. Обнови её перед сохранением, чтобы не затереть изменения.', 409);
    return project;
  }
  async uniqueSlug(text, folder) {
    const metadata = parseInfo(text, folder);
    const slug = metadata.slug || defaultSlug(child(this.config.sourcePath || '/', folder));
    const projects = await this.projects();
    if (projects.some((item) => item.metadataUnavailable)) throw new AdminError('Не удалось проверить адреса работ: часть описаний не загружена с Диска. Обнови список и повтори попытку.', 502);
    if (projects.some((item) => item.folder !== folder && item.slug === slug)) throw new AdminError('Этот адрес уже используется другой работой.', 409);
  }
  async create({ folder, metadata }) {
    this.allowedFolder(folder);
    const disk = await this.writable();
    const text = serializeMetadata(metadata, folder);
    await this.uniqueSlug(text, folder);
    const path = child(this.settings.root, folder);
    await disk.mkdir(path);
    try { await disk.upload(child(path, 'info.txt'), Buffer.from(text), false); }
    catch (error) { try { await disk.trash(path); } catch { /* The folder stays visible for recovery. */ } throw error; }
    return this.project(folder);
  }
  async save({ folder, metadata, version }) {
    const current = await this.current(folder, version);
    if (metadata.imageOrder !== undefined) {
      try { validateImageOrder(metadata.imageOrder); } catch (error) { throw new AdminError(error.message); }
      if (metadata.imageOrder.some((name) => !current.images.some((image) => image.name === name))) throw new AdminError('В порядке изображений есть отсутствующий файл. Обнови работу перед сохранением.', 409);
    }
    const text = serializeMetadata({ ...metadata, imageOrder: metadata.imageOrder ?? current.imageOrder }, folder);
    await this.uniqueSlug(text, folder);
    const path = child(this.settings.root, folder);
    const { items } = await this.writer.list(path);
    const infos = items.filter((item) => item.type === 'file' && /^info\.(txt|docx)$/i.test(item.name));
    const history = resolve(this.root, '.cache/admin/history');
    await mkdir(history, { recursive: true, mode: 0o700 });
    for (const info of infos) {
      const bytes = await this.writer.download(child(path, info.name), 1024 * 1024);
      await writeFile(resolve(history, `${randomUUID()}.json`), JSON.stringify({ folder, name: info.name, savedAt: new Date().toISOString(), base64: bytes.toString('base64') }), { mode: 0o600 });
    }
    const moved = [];
    try {
      for (const info of infos.filter((item) => item.name !== 'info.txt')) {
        const from = child(path, info.name), to = `${path}/.admin-backup-${randomUUID()}`;
        await this.writer.move(from, to); moved.push({ from, to });
      }
      await this.writer.upload(child(path, 'info.txt'), Buffer.from(text), infos.some((item) => item.name === 'info.txt'));
    } catch (error) {
      for (const move of moved.reverse()) { try { await this.writer.move(move.to, move.from); } catch { /* Local history preserves the original bytes. */ } }
      throw error;
    }
    for (const move of moved) { try { await this.writer.trash(move.to); } catch { /* A hidden backup is safe to keep. */ } }
    return this.project(folder);
  }
  async upload({ folder, name, bytes, version, replace = false }) {
    const project = await this.current(folder, version);
    component(name);
    if (!imagePattern.test(name)) throw new AdminError('Поддерживаются PNG, JPG, WebP, GIF и AVIF.');
    if (!replace) validateImage(name, bytes);
    if (!replace && project.images.some((item) => item.name.toLowerCase() === name.toLowerCase())) throw new AdminError('Файл с таким именем уже есть. Используй кнопку «Заменить».', 409);
    if (replace && !project.images.some((item) => item.name === name)) throw new AdminError('Файл для замены не найден.', 404);
    if (project.problem) throw new AdminError('Сначала исправь описание работы перед загрузкой изображений.');
    let target = webpName(name);
    if (project.images.some((item) => item.name.toLowerCase() === target.toLowerCase() && item.name !== name)) throw new AdminError('Файл с таким именем WebP уже есть. Используй кнопку «Заменить».', 409);
    const stem = name.replace(/\.[^.]+$/, '');
    if (!replace && project.images.some((item) => item.name.replace(/\.[^.]+$/, '').toLowerCase() === stem.toLowerCase())) {
      let suffix = 2;
      do { target = component(`${stem}-${suffix++}.webp`); } while (project.images.some((item) => item.name.replace(/\.[^.]+$/, '').toLowerCase() === target.replace(/\.webp$/i, '').toLowerCase()));
    }
    if ((replace && project.cover === name) || !project.images.length) target = 'cover.webp';
    const converted = await toWebp(bytes);
    const order = project.images.map((image) => image.name === name ? target : image.name);
    if (!order.includes(target)) order.push(target);
    await commitWebpImages({ disk: this.writer, directory: child(this.settings.root, folder), project,
      changes: [{ name, target, bytes: converted }], metadata: Buffer.from(serializeMetadata({ ...project, imageOrder: order }, folder)),
    });
    return { ...await this.project(folder), imageRenames: { [name]: target } };
  }

  async cover({ folder, name, version }) {
    const project = await this.current(folder, version);
    component(name);
    if (!project.images.some((item) => item.name === name)) throw new AdminError('Изображение не найдено.', 404);
    const covers = project.images.filter((item) => /^cover\./i.test(item.name));
    if (covers.length === 1 && covers[0].name === name) return project;
    const path = child(this.settings.root, folder), moved = [];
    try {
      for (const cover of covers.filter((item) => item.name !== name)) {
        const from = child(path, cover.name), to = child(path, `previous-cover-${randomUUID()}.${cover.name.split('.').at(-1)}`);
        await this.writer.move(from, to); moved.push({ from, to });
      }
      if (!/^cover\./i.test(name)) {
        const from = child(path, name), to = child(path, `cover.${name.split('.').at(-1).toLowerCase()}`);
        await this.writer.move(from, to); moved.push({ from, to });
      }
      if (project.imageOrder.length) {
        const renamed = new Map(moved.map(({ from, to }) => [from.split('/').at(-1), to.split('/').at(-1)]));
        const current = await this.project(folder);
        return await this.save({ folder, version: current.version, metadata: { ...current, imageOrder: project.images.map((image) => renamed.get(image.name) || image.name) } });
      }
    } catch (error) {
      for (const move of moved.reverse()) { try { await this.writer.move(move.to, move.from); } catch { /* Existing image bytes are never removed. */ } }
      throw error;
    }
    return this.project(folder);
  }
  async removeFile({ folder, name, version }) {
    const project = await this.current(folder, version);
    if (!project.images.some((item) => item.name === name)) throw new AdminError('Изображение не найдено.', 404);
    await this.writer.trash(child(this.settings.root, folder, name));
    return this.project(folder);
  }
  async removeProject({ folder, version }) { await this.current(folder, version); await this.writer.trash(child(this.settings.root, folder)); return { removed: true }; }
  async thumbnail(folder, name, revision = '') {
    this.allowedFolder(folder); component(name);
    if (!imagePattern.test(name)) throw new AdminError('Это не изображение.');
    const key = JSON.stringify([Boolean(this.writer), folder, name, revision]);
    const previous = this.previews.get(key);
    if (previous?.expires > Date.now()) return previous.url;
    // Public previews open directly in the browser without an OAuth header.
    const path = child(this.config.sourcePath || '/', folder, name);
    const resource = await this.publicDisk.api('', { path, preview_size: 'M', preview_crop: false });
    const url = resource.preview;
    if (!url || new URL(url).protocol !== 'https:') throw new AdminError('Превью недоступно.', 404);
    this.previews.delete(key); this.previews.set(key, { url, expires: Date.now() + 180000 });
    while (this.previews.size > 128) this.previews.delete(this.previews.keys().next().value);
    return url;
  }
}
