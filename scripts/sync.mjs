import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { YandexDisk } from './yandex.mjs';
import { decodeInfo, parseInfo, defaultSlug, imagePattern, natural } from './content.mjs';

export async function syncPortfolio({ root = process.cwd(), disk, now = new Date() } = {}) {
  const config = JSON.parse(await readFile(resolve(root, 'portfolio.config.json'), 'utf8'));
  const publicUrl = process.env.YANDEX_DISK_PUBLIC_URL || config.publicUrl;
  disk ??= new YandexDisk(publicUrl);
  const cache = resolve(root, '.cache');
  const warnings = [];
  const projects = [];
  const slugs = new Set();
  const source = await disk.list(config.sourcePath || '/');
  const folders = source.items.filter((item) => item.type === 'dir' && !item.name.startsWith('.') && !(config.ignoredFolders || []).some((name) => name.toLowerCase() === item.name.toLowerCase()));

  for (const folder of folders.sort((a, b) => natural(a.name, b.name))) {
    const { items } = await disk.list(folder.path);
    const files = items.filter((item) => item.type === 'file');
    const infos = files.filter((item) => /^info\.(txt|docx)$/i.test(item.name));
    if (infos.length > 1) throw new Error(`${folder.name}: оставьте один файл info.txt или info.docx.`);
    const info = infos[0];
    const projectWarnings = [];
    const metadata = parseInfo(info ? decodeInfo(await disk.download(info.path, 1024 * 1024), info.path, projectWarnings) : '', folder.name);
    if (!metadata.published) continue;
    warnings.push(...projectWarnings);
    const slug = metadata.slug || defaultSlug(folder.path);
    if (slugs.has(slug)) throw new Error(`Адрес «${slug}» повторяется. Задайте уникальное поле «Адрес» в info.txt.`);
    slugs.add(slug);
    if (!info) warnings.push(`${folder.name}: нет info.txt, используется название папки.`);
    const images = [];
    const imageFiles = files.filter((item) => imagePattern.test(item.name)).sort((a, b) => natural(a.name, b.name));
    for (const file of imageFiles) images.push({
      name: file.name,
      path: file.path,
      revision: String(file.md5 || file.revision || file.modified || ''),
      size: file.size,
    });
    const covers = images.filter((image) => /^cover\./i.test(image.name));
    if (covers.length > 1) throw new Error(`${folder.name}: оставьте только один файл cover.`);
    if (!images.length) warnings.push(`${folder.name}: пока нет изображений.`);
    else if (!covers.length) warnings.push(`${folder.name}: нет cover, обложкой будет первое изображение.`);
    projects.push({ ...metadata, slug, folder: folder.name, images, cover: covers[0] || images[0] || null, hasInfo: Boolean(info) });
  }
  projects.sort((a, b) => a.order - b.order || natural(a.title, b.title));
  const snapshot = { schemaVersion: 2, storage: 'yandex-direct', publicUrl, syncedAt: now.toISOString(), sourceName: source.name, projects, warnings };
  await mkdir(cache, { recursive: true });
  await writeFile(resolve(cache, 'portfolio.json.tmp'), JSON.stringify(snapshot, null, 2));
  await rename(resolve(cache, 'portfolio.json.tmp'), resolve(cache, 'portfolio.json'));
  return snapshot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const snapshot = await syncPortfolio();
    console.log(`Синхронизация завершена. Папка: ${snapshot.sourceName}. Проектов: ${snapshot.projects.length}.`);
    for (const warning of snapshot.warnings) console.warn(`  ${warning}`);
  } catch (error) {
    console.error(`Синхронизация не выполнена: ${error.message}\nПредыдущая успешная копия сохранена. Сборка и публикация должны выполняться только после успешной синхронизации.`);
    process.exitCode = 1;
  }
}
