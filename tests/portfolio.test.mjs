import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { createAutoRefresh, DAY_MS } from '../scripts/auto-refresh.mjs';
import { syncPortfolio } from '../scripts/sync.mjs';
import { buildPortfolio } from '../scripts/build.mjs';
import { YandexDisk } from '../scripts/yandex.mjs';
import { decodeInfo, parseInfo } from '../scripts/content.mjs';

const text = 'Название: Кофейня «Ёж» <script>alert(1)</script>\r\nКатегория: Брендинг\r\nПорядок: 2\r\nАдрес: ezh\r\nОписание:\r\nПервый абзац.\r\n\r\nВторой абзац.';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

function fixture() {
  const files = new Map([
    ['/Кофейня/info.txt', Buffer.from('\uFEFF' + text)],
    ['/Кофейня/cover.png', png],
    ['/Кофейня/10.png', png],
    ['/Кофейня/02.png', png],
    ['/Скрыто/info.txt', Buffer.from('Публиковать: нет')],
  ]);
  const dirs = {
    '/': ['Кофейня', 'Пустой', 'Скрыто', 'Черновики'].map((name) => ({ type: 'dir', name, path: `/${name}` })),
    '/Пустой': [],
    '/Кофейня': [...files.keys()].filter((path) => path.startsWith('/Кофейня/')).map((path) => ({ type: 'file', path, name: path.split('/').at(-1), size: files.get(path).length, md5: createHash('md5').update(files.get(path)).digest('hex') })),
    '/Скрыто': [{ type: 'file', path: '/Скрыто/info.txt', name: 'info.txt' }],
  };
  const requests = [];
  const fetchImpl = async (input) => {
    const url = new URL(input);
    requests.push(url);
    if (url.hostname === 'files.example') return new Response(files.get(url.searchParams.get('path')));
    const path = url.searchParams.get('path');
    if (url.pathname.endsWith('/download')) return Response.json({ href: `https://files.example/?path=${encodeURIComponent(path)}` });
    assert.ok(dirs[path], `Unexpected folder ${path}`);
    const offset = Number(url.searchParams.get('offset'));
    // Force pagination even for tiny folders; client must follow the actual batch size.
    return Response.json({ name: path === '/' ? 'РаботыСайт' : path.slice(1), type: 'dir', _embedded: { total: dirs[path].length, items: dirs[path].slice(offset, offset + 2) } });
  };
  return { files, dirs, requests, disk: new YandexDisk('https://disk.yandex.ru/d/test', fetchImpl) };
}

async function setup(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'portfolio-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(resolve(root, 'portfolio.config.json'), JSON.stringify({ title: 'Портфолио', description: 'Описание', publicUrl: 'https://disk.yandex.ru/d/test', sourcePath: '/', ignoredFolders: ['Черновики'] }));
  await mkdir(resolve(root, 'src'));
  await writeFile(resolve(root, 'src/style.css'), 'body{}');
  return root;
}

test('end-to-end: paginated catalog, Unicode paths and static pages without downloading media', async (t) => {
  const root = await setup(t);
  const f = fixture();
  const data = await syncPortfolio({ root, disk: f.disk });
  assert.equal(data.projects.length, 2);
  assert.equal(data.projects[0].title, 'Кофейня «Ёж» <script>alert(1)</script>');
  assert.deepEqual(data.projects[0].images.map((x) => x.name), ['02.png', '10.png', 'cover.png']);
  assert.equal(data.projects[0].cover.name, 'cover.png');
  assert.ok(f.requests.some((u) => u.searchParams.get('offset') === '2'));
  assert.ok(!f.requests.some((u) => u.searchParams.get('path') === '/Черновики'));
  await buildPortfolio(root);
  const home = await readFile(resolve(root, 'dist/index.html'), 'utf8');
  assert.ok(home.includes('./projects/ezh/'));
  assert.ok(home.includes('Нет материалов'));
  assert.ok(!home.includes('Скрыто'));
  assert.ok(!home.includes('<script>alert(1)</script>'));
  const project = await readFile(resolve(root, 'dist/projects/ezh/index.html'), 'utf8');
  assert.ok(project.includes('Первый абзац.</p><p>Второй абзац.'));
  assert.ok(project.includes('data-disk-path="/Кофейня/02.png"'));
  assert.ok(home.includes('data-disk-mode="full"'), 'portfolio cards must load originals');
  assert.ok(!home.includes('data-disk-mode="preview"'), 'large covers must never request reduced previews');
  assert.ok(home.includes('referrerpolicy="no-referrer"'), 'Yandex media rejects a foreign Referer header');
  assert.ok(project.includes('data-disk-mode="full"'));
  assert.ok(!project.includes('<img class="remote-image" src='), 'portfolio images must resolve from Disk only when visible');
  assert.ok(data.projects[0].images.every((image) => !image.src));
  await assert.rejects(access(resolve(root, 'dist/assets')));
  await assert.rejects(access(resolve(root, '.cache/assets')));
  await syncPortfolio({ root, disk: f.disk });
  assert.equal(f.requests.filter((u) => u.hostname === 'files.example' && u.searchParams.get('path')?.endsWith('.png')).length, 0, 'only descriptions are downloaded during sync');
  // Even very large originals remain on Disk and do not make the Pages build large.
  f.dirs['/Кофейня'][1].size = 5 * 1024 ** 3;
  await syncPortfolio({ root, disk: f.disk });
  await buildPortfolio(root);
  assert.ok((await readFile(resolve(root, 'dist/portfolio.json'))).length < 10000);
});

test('bad UTF-8, API failure, duplicate slugs and old media snapshots preserve the previous site', async (t) => {
  const root = await setup(t);
  const first = fixture();
  await syncPortfolio({ root, disk: first.disk });
  await buildPortfolio(root);
  const snapshot = await readFile(resolve(root, '.cache/portfolio.json'), 'utf8');
  const home = await readFile(resolve(root, 'dist/index.html'), 'utf8');
  const invalid = fixture();
  invalid.files.set('/Кофейня/info.txt', Buffer.from([0xff, 0xfe, 0x20]));
  await assert.rejects(syncPortfolio({ root, disk: invalid.disk }), /UTF-8/);
  await assert.rejects(syncPortfolio({ root, disk: { list() { throw new Error('Network unavailable'); } } }), /Network unavailable/);
  const duplicate = fixture();
  duplicate.files.set('/Скрыто/info.txt', Buffer.from('Адрес: ezh'));
  await assert.rejects(syncPortfolio({ root, disk: duplicate.disk }), /повторяется/);
  assert.equal(await readFile(resolve(root, '.cache/portfolio.json'), 'utf8'), snapshot);
  assert.equal(await readFile(resolve(root, 'dist/index.html'), 'utf8'), home);
  await writeFile(resolve(root, '.cache/portfolio.json'), JSON.stringify({ ...JSON.parse(snapshot), schemaVersion: 1 }));
  await assert.rejects(buildPortfolio(root), /npm run sync/);
  assert.equal(await readFile(resolve(root, 'dist/index.html'), 'utf8'), home);
});

test('removed work disappears only after successful refresh', async (t) => {
  const root = await setup(t);
  const f = fixture();
  await syncPortfolio({ root, disk: f.disk });
  await buildPortfolio(root);
  f.dirs['/'] = f.dirs['/'].filter((item) => item.name !== 'Кофейня');
  await syncPortfolio({ root, disk: f.disk });
  await buildPortfolio(root);
  await assert.rejects(access(resolve(root, 'dist/projects/ezh/index.html')));
  assert.ok(!(await readFile(resolve(root, 'dist/index.html'), 'utf8')).includes('./projects/ezh/'));
});

test('Word renamed to TXT: deflated main document, split runs, entities and paragraph breaks', () => {
  const name = Buffer.from('word/document.xml');
  const xml = Buffer.from('<w:document><w:p><w:r><w:t>Название: </w:t></w:r><w:r><w:t>Ёж &amp; кофе</w:t></w:r></w:p><w:p><w:r><w:t>Описание:</w:t></w:r></w:p><w:p><w:r><w:t>Первая строка.</w:t><w:br/><w:t>Вторая строка.</w:t></w:r></w:p></w:document>');
  const compressed = deflateRawSync(xml);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(xml.length, 22);
  header.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(xml.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + name.length, 12);
  end.writeUInt32LE(30 + name.length + compressed.length, 16);
  const word = Buffer.concat([header, name, compressed, central, name, end]);
  const warnings = [];
  const result = parseInfo(decodeInfo(word, 'info.txt', warnings), 'Пример');
  assert.equal(result.title, 'Ёж & кофе');
  assert.equal(result.description, 'Первая строка.\nВторая строка.');
  assert.equal(warnings.length, 1);
  assert.equal(parseInfo('Привет как дела', 'Пример').description, 'Привет как дела');
  assert.throws(() => decodeInfo(Buffer.from('PK\x03\x04invalid archive'), 'info.txt'), /DOCX/);
});

test('automatic refresh: only real content changes produce a new site version', async (t) => {
  const root = await setup(t);
  const f = fixture();
  const errors = [];
  const updater = createAutoRefresh({
    refresh: async () => {
      await syncPortfolio({ root, disk: f.disk });
      return buildPortfolio(root, { skipUnchanged: true });
    },
    onError: (error) => errors.push(error.message),
  });
  const first = await updater.run();
  const page = await readFile(resolve(root, 'dist/index.html'), 'utf8');
  assert.ok(page.includes(`name="portfolio-version" content="${first.version}"`));
  const unchanged = await updater.run();
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.version, first.version);
  assert.equal(await readFile(resolve(root, 'dist/index.html'), 'utf8'), page);
  f.files.set('/Кофейня/info.txt', Buffer.from('Название: Новая работа\nАдрес: ezh\nОписание:\nНовое описание.'));
  const changed = await updater.run();
  assert.equal(changed.changed, true);
  assert.notEqual(changed.version, first.version);
  assert.ok((await readFile(resolve(root, 'dist/projects/ezh/index.html'), 'utf8')).includes('Новое описание.'));
  f.files.set('/Кофейня/info.txt', Buffer.from([0xff]));
  const failed = await updater.run();
  assert.ok(failed.error);
  assert.equal(errors.length, 1);
  assert.equal(JSON.parse(await readFile(resolve(root, 'dist/site-version.json'), 'utf8')).version, changed.version);
  f.files.set('/Кофейня/info.txt', Buffer.from('Название: Исправлено\nАдрес: ezh'));
  const recovered = await updater.run();
  assert.equal(recovered.changed, true);
  assert.notEqual(recovered.version, changed.version);
  await writeFile(resolve(root, 'src/style.css'), 'body{color:red}');
  assert.notEqual((await buildPortfolio(root, { skipUnchanged: true })).version, recovered.version);
});

test('daily scheduler: no concurrent refreshes, no short retry on failure, stoppable timer', async () => {
  const queued = [];
  const cancelled = [];
  let complete;
  let calls = 0;
  const errors = [];
  const updater = createAutoRefresh({
    refresh: () => { calls++; return new Promise((resolve) => { complete = resolve; }); },
    schedule: (callback, delay) => { queued.push({ callback, delay }); return queued.length; },
    cancel: (timer) => cancelled.push(timer),
    onError: (error) => errors.push(error.message),
  });
  const first = updater.run();
  assert.equal(updater.run(), first);
  await Promise.resolve();
  assert.equal(calls, 1);
  complete({ changed: false });
  await first;
  updater.start();
  updater.start();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].delay, 86400000);
  assert.equal(DAY_MS, 86400000);
  const tick = queued[0].callback();
  await Promise.resolve();
  assert.equal(calls, 2);
  updater.stop();
  complete({ changed: true });
  await tick;
  assert.equal(queued.length, 1, 'stopped updater must not schedule after a pending request');
  updater.start();
  updater.stop();
  assert.deepEqual(cancelled, [2]);
  assert.equal(errors.length, 0);
  const retryTimers = [];
  const failing = createAutoRefresh({
    refresh: () => { throw new Error('offline'); },
    onError: (error) => errors.push(error.message),
    schedule: (callback, delay) => { retryTimers.push({ callback, delay }); return retryTimers.length; },
    cancel: () => {},
  });
  failing.start();
  await retryTimers[0].callback();
  assert.equal(retryTimers.length, 2);
  assert.ok(retryTimers.every((timer) => timer.delay === DAY_MS));
  assert.deepEqual(errors, ['offline']);
  failing.stop();
});
