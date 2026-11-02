import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { AdminService, serializeMetadata } from '../admin/service.mjs';
import { AdminError } from '../admin/disk.mjs';
import { toWebp, commitWebpImages } from '../admin/webp.mjs';
import { preferWebpImages, webpImageOrder } from '../scripts/content.mjs';

const rgba = Buffer.from([255, 10, 30, 255, 11, 180, 240, 128, 99, 45, 187, 0]);
const png = await sharp(rgba, { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
const jpeg = await sharp({ create: { width: 5, height: 4, channels: 3, background: '#3f729f' } }).jpeg().toBuffer();
const pixels = (bytes) => sharp(bytes, { animated: true }).ensureAlpha().raw().toBuffer();
const md5 = (bytes) => createHash('md5').update(bytes).digest('hex');
const ROOT = 'disk:/РаботыСайт', DIR = ROOT + '/Постер';
const metadata = { title: 'Постер', category: 'Печать', year: '2026', order: 7, slug: 'poster', published: true, description: 'Точный цвет и порядок', imageOrder: ['02.jpg', 'cover.png'] };

test('lossless WebP retains every RGBA pixel, dimensions and JPEG decoded quality', async () => {
  const converted = await toWebp(png);
  const info = await sharp(converted).metadata();
  assert.equal(info.format, 'webp'); assert.equal(info.width, 3); assert.equal(info.height, 1); assert.equal(info.hasAlpha, true);
  assert.deepEqual(await pixels(converted), rgba, 'even RGB underneath fully transparent pixels survives');
  const photo = await toWebp(jpeg);
  assert.deepEqual(await pixels(photo), await pixels(jpeg));
  assert.equal(await toWebp(converted), converted, 'already-WebP files are not recompressed');
  await assert.rejects(toWebp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')), /не соответствует/);
  await assert.rejects(toWebp(png.subarray(0, 40)), /не соответствует/);
});

test('animated GIF conversion keeps all frames and timing', async () => {
  const second = await sharp(png).negate({ alpha: false }).png().toBuffer();
  const gif = await sharp([png, second], { join: { animated: true } }).gif({ loop: 3, delay: [100, 240] }).toBuffer();
  const converted = await toWebp(gif);
  const before = await sharp(gif, { animated: true }).metadata(), after = await sharp(converted, { animated: true }).metadata();
  assert.equal(before.pages, 2); assert.equal(after.pages, before.pages); assert.deepEqual(after.delay, before.delay); assert.equal(after.loop, before.loop);
  assert.deepEqual(await pixels(converted), await pixels(gif));
});

class Disk {
  constructor() {
    this.files = new Map([[DIR + '/info.txt', Buffer.from(serializeMetadata(metadata, 'Постер'))], [DIR + '/cover.png', png], [DIR + '/02.jpg', jpeg]]);
    this.dirs = new Set([ROOT, DIR]); this.failInfo = false;
  }
  async resource(path) { const bytes = this.files.get(path); if (bytes) return { type: 'file', size: bytes.length, md5: md5(bytes) }; if (this.dirs.has(path)) return { type: 'dir', public_url: 'https://disk.yandex.ru/d/test' }; throw new AdminError('Нет файла', 404); }
  async list(path) {
    const prefix = path + '/';
    return { items: [...this.files].filter(([file]) => file.startsWith(prefix) && !file.slice(prefix.length).includes('/')).map(([file, bytes]) => ({ name: file.slice(prefix.length), type: 'file', size: bytes.length, md5: md5(bytes) })) };
  }
  async download(path) { if (!this.files.has(path)) throw new AdminError('Нет файла', 404); return this.files.get(path); }
  async mkdir(path) { this.dirs.add(path); }
  async upload(path, bytes, overwrite) {
    if (this.failInfo && path === DIR + '/info.txt') { this.failInfo = false; throw new AdminError('Ошибка описания', 502); }
    if (this.files.has(path) && !overwrite) throw new AdminError('Занято', 409);
    this.files.set(path, Buffer.from(bytes));
    this.afterStage?.(path);
  }
  async move(from, to, overwrite = false) { if (!this.files.has(from)) throw new AdminError('Нет файла', 404); if (this.files.has(to) && !overwrite) throw new AdminError('Занято', 409); this.files.set(to, this.files.get(from)); this.files.delete(from); }
  async trash(path) { if (!this.files.has(path)) throw new AdminError('Нет файла', 404); this.files.delete(path); }
}
function app() {
  const disk = new Disk();
  const service = new AdminService({ root: '/tmp', config: { publicUrl: 'https://disk.yandex.ru/d/test', sourcePath: '/' } });
  service.settings = { root: ROOT }; service.writer = disk; service.verified = Date.now();
  return { disk, service };
}

test('admin uploads convert to WebP, append in order and allow PNG/JPEG replacements of WebP', async () => {
  const { disk, service } = app();
  let project = await service.project('Постер');
  project = await service.upload({ folder: 'Постер', version: project.version, name: 'Аватарка.png', bytes: png });
  assert.deepEqual(project.images.map((image) => image.name), ['02.jpg', 'cover.png', 'Аватарка.webp']);
  assert.deepEqual(project.imageRenames, { 'Аватарка.png': 'Аватарка.webp' });
  await assert.rejects(service.upload({ folder: 'Постер', version: project.version, name: 'Аватарка.png', bytes: png }), /уже есть/);
  project = await service.upload({ folder: 'Постер', version: project.version, name: 'Аватарка.webp', bytes: jpeg, replace: true });
  assert.equal((await sharp(disk.files.get(DIR + '/Аватарка.webp')).metadata()).width, 5);
  project = await service.upload({ folder: 'Постер', version: project.version, name: 'cover.png', bytes: png, replace: true });
  assert.equal(project.cover, 'cover.webp');
  assert.deepEqual(project.imageOrder, ['02.jpg', 'cover.webp', 'Аватарка.webp']);
  assert.ok([...disk.files].some(([path, bytes]) => path.includes('/.webp-originals-') && path.endsWith('/cover.png') && bytes.equals(png)));
});

test('failed metadata writes restore image names, original bytes and exact description', async () => {
  const { disk, service } = app();
  const original = new Map(disk.files);
  const project = await service.project('Постер'); disk.failInfo = true;
  await assert.rejects(service.upload({ folder: 'Постер', version: project.version, name: 'cover.png', bytes: png, replace: true }), /Ошибка описания/);
  assert.deepEqual(disk.files, original);
});

test('migration keeps old live image paths until publication and avoids duplicate covers', async () => {
  const { disk, service } = app(); const project = await service.project('Постер');
  const changes = [{ name: 'cover.png', target: 'cover.webp', bytes: await toWebp(png) }, { name: '02.jpg', target: '02.webp', bytes: await toWebp(jpeg) }];
  await commitWebpImages({ disk, directory: DIR, project, changes, retainOriginals: true, metadata: Buffer.from(serializeMetadata({ ...project, imageOrder: ['02.webp', 'cover.webp'] }, 'Постер')) });
  assert.ok(disk.files.has(DIR + '/cover.png')); assert.ok(disk.files.has(DIR + '/02.jpg'));
  const result = await service.project('Постер');
  assert.equal(result.cover, 'cover.webp');
  assert.deepEqual(result.images.map((image) => image.name), ['02.webp', 'cover.webp']);
  assert.deepEqual(webpImageOrder(result.images, ['02.jpg', 'cover.png']), ['02.webp', 'cover.webp']);
  assert.equal(preferWebpImages((await disk.list(DIR)).items).length, 2);
});

test('external edits or checksum failures stop conversion before touching originals', async () => {
  const { disk, service } = app(); let project = await service.project('Постер');
  const bytes = await toWebp(png), original = new Map(disk.files);
  const changes = [{ name: 'cover.png', target: 'cover.webp', bytes }];
  await assert.rejects(commitWebpImages({ disk, directory: DIR, project, changes, metadata: Buffer.from('bad'), verifyUpload: async () => { throw new Error('checksum'); } }), /checksum/);
  assert.deepEqual(disk.files, original);
  disk.afterStage = () => disk.files.set(DIR + '/info.txt', Buffer.from('Описание: пользовательская правка'));
  await assert.rejects(commitWebpImages({ disk, directory: DIR, project, changes, metadata: Buffer.from('bad') }), /изменилась/);
  assert.equal(disk.files.get(DIR + '/info.txt').toString(), 'Описание: пользовательская правка');
  assert.deepEqual(disk.files.get(DIR + '/cover.png'), png);
});
