import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, access, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { request } from 'node:http';
import { hash } from '../scripts/content.mjs';
import { AdminService, serializeMetadata, validateImage } from '../admin/service.mjs';
import { AdminError, WritableDisk, component, diskRoot } from '../admin/disk.mjs';
import { createAdminServer, MAX_UPLOAD } from '../scripts/admin.mjs';
import { Publication } from '../admin/publication.mjs';

const ROOT = 'disk:/РаботыСайт';
const config = { publicUrl: 'https://disk.yandex.ru/d/test-share', sourcePath: '/', ignoredFolders: ['Черновики'] };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const meta = (title = 'Работа') => ({ title, category: 'Постеры', year: '2026', order: 2, slug: '', description: 'Первый абзац.\n\nВторой.', published: true });
export class MemoryDisk {
  constructor() { this.dirs = new Set([ROOT, ROOT + '/Постер']); this.files = new Map([[ROOT + '/Постер/info.txt', Buffer.from(serializeMetadata(meta(), 'Постер'))], [ROOT + '/Постер/cover.png', png], [ROOT + '/Постер/02.png', png]]); this.trashed = []; this.failUpload = false; this.failMove = false; }
  async resource(path) { if (!this.dirs.has(path)) throw new AdminError('Не найдено.', 404); return { type: 'dir', public_url: path === ROOT ? config.publicUrl : 'https://disk.yandex.ru/d/other' }; }
  async list(path) {
    if (!this.dirs.has(path)) throw new AdminError('Не найдено.', 404);
    const prefix = path + '/'; const items = [];
    for (const dir of this.dirs) if (dir.startsWith(prefix) && !dir.slice(prefix.length).includes('/')) items.push({ type: 'dir', name: dir.slice(prefix.length), path: dir });
    for (const [file, bytes] of this.files) if (file.startsWith(prefix) && !file.slice(prefix.length).includes('/')) items.push({ type: 'file', name: file.slice(prefix.length), path: file, size: bytes.length, md5: hash(bytes) });
    return { name: path.split('/').at(-1), items };
  }
  async download(path) { if (!this.files.has(path)) throw new AdminError('Не найдено.', 404); return this.files.get(path); }
  async upload(path, bytes, overwrite) { if (this.failUpload) throw new AdminError('Ошибка загрузки.', 502); if (!overwrite && this.files.has(path)) throw new AdminError('Уже есть.', 409); this.files.set(path, Buffer.from(bytes)); }
  async mkdir(path) { if (this.dirs.has(path)) throw new AdminError('Уже есть.', 409); this.dirs.add(path); }
  async move(from, to, overwrite = false) { if (this.failMove && to.endsWith('/cover.png')) { this.failMove = false; throw new AdminError('Ошибка перемещения.', 502); } if (!this.files.has(from)) throw new AdminError('Не найдено.', 404); if (this.files.has(to) && !overwrite) throw new AdminError('Уже есть.', 409); this.files.set(to, this.files.get(from)); this.files.delete(from); }
  async trash(path) { this.trashed.push(path); for (const file of this.files.keys()) if (file === path || file.startsWith(path + '/')) this.files.delete(file); for (const dir of this.dirs) if (dir === path || dir.startsWith(path + '/')) this.dirs.delete(dir); }
}
async function setup(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'portfolio-admin-')); t.after(() => rm(root, { recursive: true, force: true }));
  const disk = new MemoryDisk();
  const publicDisk = { list: (path) => disk.list(ROOT + path.replace(/\/$/, '')), download: (path) => disk.download(ROOT + path) };
  const service = await new AdminService({ root, config, publicDisk, writerFactory: (token) => { if (token !== 'local-secret-token') throw new AdminError('Некорректный токен.'); return disk; } }).init();
  return { root, disk, service, connect: () => service.connect({ token: 'local-secret-token', root: ROOT }) };
}

test('local admin remains read-only without a token and checks the selected public folder before storing secrets', async (t) => {
  const app = await setup(t);
  assert.equal((await app.service.projects())[0].title, 'Работа');
  await assert.rejects(app.service.create({ folder: 'Новая', metadata: meta() }), /подключи Диск/);
  app.disk.dirs.add(ROOT + '/Чужая');
  await assert.rejects(app.service.connect({ token: 'local-secret-token', root: ROOT + '/Чужая' }), /не совпадает/);
  await assert.rejects(access(app.service.settingsPath));
  const status = await app.connect();
  assert.equal(status.connected, true); assert.ok(!JSON.stringify(status).includes('local-secret-token'));
  assert.equal((await stat(app.service.settingsPath)).mode & 0o777, 0o600);
  const reopened = await new AdminService({ root: app.root, config, writerFactory: () => app.disk }).init();
  assert.equal(reopened.status().connected, true);
});

test('metadata saves preserve original bytes, stable links and Unicode, and refuse stale revisions or duplicate addresses', async (t) => {
  const app = await setup(t); await app.connect();
  const original = await app.service.project('Постер');
  const saved = await app.service.save({ folder: 'Постер', version: original.version, metadata: { ...original, title: 'Ёж <script>', published: false } });
  assert.equal(saved.title, 'Ёж <script>'); assert.equal(saved.published, false); assert.equal(saved.slug, original.slug);
  const history = await readdir(resolve(app.root, '.cache/admin/history'));
  assert.equal(history.length, 1);
  const backup = JSON.parse(await readFile(resolve(app.root, '.cache/admin/history', history[0])));
  assert.equal(Buffer.from(backup.base64, 'base64').toString(), serializeMetadata(meta(), 'Постер'));
  await assert.rejects(app.service.save({ folder: 'Постер', version: original.version, metadata: meta() }), /изменилась/);
  await assert.rejects(app.service.create({ folder: 'Копия', metadata: { ...meta(), slug: saved.slug } }), /уже используется/);
  assert.ok(!app.disk.dirs.has(ROOT + '/Копия'));
  assert.throws(() => serializeMetadata({ ...meta(), title: 'Название\nПубликовать: нет' }, 'Постер'), /Название/);
});

test('connected admin resolves browser previews through the public API and caches only URLs', async (t) => {
  const app = await setup(t); await app.connect(); let calls = 0;
  app.service.publicDisk.api = async (endpoint, params) => {
    calls++; assert.equal(params.path, '/Постер/cover.png'); assert.equal(params.preview_crop, false);
    return { preview: 'https://downloader.disk.yandex.net/preview/test' };
  };
  assert.equal(await app.service.thumbnail('Постер', 'cover.png', 'one'), 'https://downloader.disk.yandex.net/preview/test');
  await app.service.thumbnail('Постер', 'cover.png', 'one'); assert.equal(calls, 1);
  await app.service.thumbnail('Постер', 'cover.png', 'two'); assert.equal(calls, 2);
});

test('legacy descriptions migrate to one TXT, and failed uploads restore the legacy file', async (t) => {
  const app = await setup(t); await app.connect();
  const bytes = app.disk.files.get(ROOT + '/Постер/info.txt');
  app.disk.files.delete(ROOT + '/Постер/info.txt'); app.disk.files.set(ROOT + '/Постер/info.docx', bytes);
  let project = await app.service.project('Постер'); app.disk.failUpload = true;
  await assert.rejects(app.service.save({ folder: 'Постер', version: project.version, metadata: { ...project, title: 'Новое' } }), /Ошибка загрузки/);
  assert.deepEqual(app.disk.files.get(ROOT + '/Постер/info.docx'), bytes);
  assert.equal(app.disk.files.has(ROOT + '/Постер/info.txt'), false);
  app.disk.failUpload = false; project = await app.service.project('Постер');
  await app.service.save({ folder: 'Постер', version: project.version, metadata: { ...project, title: 'Новое' } });
  assert.equal(app.disk.files.has(ROOT + '/Постер/info.docx'), false);
  assert.equal((await app.service.project('Постер')).title, 'Новое');
  assert.ok(app.disk.trashed.some((path) => path.includes('.admin-backup-')));
});

test('cover changes preserve old images, roll back failed moves and never delete originals permanently', async (t) => {
  const app = await setup(t); await app.connect();
  const original = await app.service.project('Постер');
  app.disk.failMove = true;
  await assert.rejects(app.service.cover({ folder: 'Постер', name: '02.png', version: original.version }), /Ошибка перемещения/);
  assert.ok(app.disk.files.has(ROOT + '/Постер/cover.png')); assert.ok(app.disk.files.has(ROOT + '/Постер/02.png'));
  app.disk.failMove = false;
  const changed = await app.service.cover({ folder: 'Постер', name: '02.png', version: original.version });
  assert.equal(changed.cover, 'cover.png'); assert.equal(changed.images.length, 2);
  assert.ok(changed.images.some((item) => item.name.startsWith('previous-cover-')));
  assert.equal(app.disk.trashed.length, 0);
  const removed = await app.service.removeFile({ folder: 'Постер', name: 'cover.png', version: changed.version });
  assert.equal(removed.images.length, 1); assert.equal(app.disk.trashed.at(-1), ROOT + '/Постер/cover.png');
  await assert.rejects(app.service.removeProject({ folder: '..', version: removed.version }), /Недопустимое/);
});

test('uploads require a supported image signature and explicit replacement; creation failure preserves existing projects', async (t) => {
  const app = await setup(t); await app.connect(); const project = await app.service.project('Постер');
  await assert.rejects(app.service.upload({ folder: 'Постер', name: 'cover.png', version: project.version, bytes: png }), /уже есть/);
  await assert.rejects(app.service.upload({ folder: 'Постер', name: 'cover.png', version: project.version, bytes: Buffer.from('<script>bad</script>'), replace: true }), /не соответствует/);
  await assert.rejects(app.service.upload({ folder: 'Постер', name: '../info.txt', version: project.version, bytes: png }), /Недопустимое/);
  const updated = await app.service.upload({ folder: 'Постер', name: 'новое.png', version: project.version, bytes: png });
  assert.equal(updated.images.length, 3);
  app.disk.failUpload = true;
  await assert.rejects(app.service.create({ folder: 'Новая', metadata: meta() }), /Ошибка загрузки/);
  assert.equal(app.disk.dirs.has(ROOT + '/Новая'), false); assert.ok(app.disk.dirs.has(ROOT + '/Постер'));
  for (const name of ['..', '/foo', 'a\\b', 'x\0y', '.hidden']) assert.throws(() => component(name));
  assert.throws(() => diskRoot('/')); assert.throws(() => diskRoot('/Работы/../Документы'));
  assert.throws(() => validateImage('постер.svg', png));
});

test('authenticated Disk calls keep OAuth on the API host, follow operations safely and use recoverable deletion', async () => {
  const calls = [];
  const disk = new WritableDisk('token', { sleep: async () => {}, fetchImpl: async (input, options = {}) => {
    const url = new URL(input); calls.push({ url, options });
    if (url.hostname.startsWith('uploader.')) return new Response(null, { status: 201 });
    if (url.pathname.endsWith('/upload')) return Response.json({ href: 'https://uploader.disk.yandex.net/file' });
    if (url.pathname.includes('/operations/')) return Response.json({ status: 'success' });
    return Response.json({ href: 'https://cloud-api.yandex.net/v1/disk/operations/one' }, { status: 202 });
  } });
  await disk.upload(ROOT + '/Постер/cover.png', png, true);
  assert.equal(calls[0].options.headers.Authorization, 'OAuth token');
  assert.equal(calls[1].options.headers, undefined, 'signed upload URLs must not receive the OAuth header');
  await disk.trash(ROOT + '/Постер/cover.png');
  assert.equal(calls[2].url.searchParams.get('permanently'), 'false');
  assert.equal(calls[3].url.hostname, 'cloud-api.yandex.net');
  const unsafe = new WritableDisk('token', { fetchImpl: async () => Response.json({ href: 'https://attacker.example/upload' }) });
  await assert.rejects(unsafe.upload(ROOT + '/x.png', png), /неподходящую ссылку/);
});

test('HTTP admin rejects forged origins and paths, limits uploads and never serves secret files', async (t) => {
  const app = await setup(t);
  const publication = { state: { active: false, status: 'idle' }, start: () => ({ active: true }) };
  const running = await createAdminServer({ root: app.root, service: app.service, publication, port: 0 });
  t.after(() => new Promise((done) => { running.server.closeAllConnections(); running.server.close(done); }));
  const session = await (await fetch(running.url + '/api/session')).json();
  const url = running.url + '/api/settings';
  assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', headers: { Origin: 'https://evil.example', 'X-Admin-Key': session.key }, body: '{}' })).status, 403);
  const headers = { Origin: running.url, 'X-Admin-Key': session.key, 'Content-Type': 'application/json' };
  const connected = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ token: 'local-secret-token', root: ROOT }) });
  assert.equal(connected.status, 200); assert.ok(!(await connected.text()).includes('local-secret-token'));
  for (const path of ['/.cache/admin/settings.json', '/.env.local', '/%2e%2e/portfolio.config.json']) assert.equal((await fetch(running.url + path)).status, 404);
  const hostile = await fetch(running.url + '/api/project?folder=' + encodeURIComponent('../other'));
  assert.equal(hostile.status, 400);
  const uploadStatus = await new Promise((done, reject) => {
    const req = request(running.url + '/api/upload?folder=test&name=x.png', { method: 'POST', headers: { ...headers, 'Content-Length': String(MAX_UPLOAD + 1) } }, (res) => { res.resume(); res.once('end', () => done(res.statusCode)); });
    req.once('error', reject); req.setTimeout(5000, () => req.destroy(new Error('Upload limit response timed out.'))); req.end('x');
  });
  assert.equal(uploadStatus, 413);
});

test('publication waits for writes, dispatches the existing workflow once and tracks its exact run', async () => {
  const events = []; let count = 0;
  const service = { exclusive: async (task) => { events.push('queue'); await task(); } };
  const publication = new Publication({ root: '.', service, sleep: async () => {}, refresh: async () => { events.push('refresh'); }, run: async (args) => {
    if (args[0] === 'workflow') { events.push('dispatch'); return { stdout: '' }; }
    count++;
    return { stdout: JSON.stringify(count === 1 ? [{ databaseId: 1 }] : [{ databaseId: 2, status: 'completed', conclusion: 'success', url: 'https://github.com/owner/repo/actions/runs/2', createdAt: new Date().toISOString() }]) };
  } });
  publication.start(); assert.throws(() => publication.start(), /уже запущено/);
  await publication.pending;
  assert.deepEqual(events, ['queue', 'refresh', 'dispatch']);
  assert.equal(publication.state.status, 'success'); assert.equal(publication.state.active, false);
  assert.equal(publication.state.url, 'https://github.com/owner/repo/actions/runs/2');
});
