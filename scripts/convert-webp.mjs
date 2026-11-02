import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { AdminService, serializeMetadata } from '../admin/service.mjs';
import { child } from '../admin/disk.mjs';
import { toWebp, webpName, commitWebpImages } from '../admin/webp.mjs';

const md5 = (bytes) => createHash('md5').update(bytes).digest('hex');

export async function convertPortfolioWebp(root, mode) {
  const directory = resolve(root, '.cache/webp-migration');
  const manifest = resolve(directory, 'plan.json');
  const config = JSON.parse(await readFile(resolve(root, 'portfolio.config.json'), 'utf8'));
  const service = await new AdminService({ root, config }).init();
  const disk = await service.writable();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const save = async (plan) => {
    await writeFile(manifest + '.tmp', JSON.stringify(plan, null, 2), { mode: 0o600 });
    await rename(manifest + '.tmp', manifest);
  };
  let plan;
  try { plan = JSON.parse(await readFile(manifest, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (plan && (plan.publicUrl !== config.publicUrl || plan.diskRoot !== service.settings.root)) throw new Error('План относится к другой папке Диска.');
  if (mode === 'prepare') {
    if (!plan) {
      console.log('Проверяю актуальный список опубликованных работ…');
      const projects = (await service.projects()).filter((project) => project.published);
      if (projects.some((project) => project.problem || project.metadataUnavailable)) throw new Error('Сначала исправь ошибки описаний опубликованных работ. Диск не изменён.');
      plan = { publicUrl: config.publicUrl, diskRoot: service.settings.root, createdAt: new Date().toISOString(), prepared: false,
        projects: projects.map((project) => ({ project, images: [], applied: false })),
      };
      await save(plan);
    }
    for (const [projectIndex, entry] of plan.projects.entries()) {
      if (entry.applied) continue;
      const project = await service.current(entry.project.folder, entry.project.version);
      const folder = child(plan.diskRoot, project.folder);
      const reserved = new Set(project.images.map((image) => image.name.toLowerCase()));
      entry.images.forEach((image) => reserved.add(image.target.toLowerCase()));
      for (const [imageIndex, image] of project.images.entries()) {
        if (/\.webp$/i.test(image.name) || entry.images.some((saved) => saved.name === image.name)) continue;
        const bytes = await disk.download(child(folder, image.name), 128 * 1024 * 1024);
        if (/^[a-f0-9]{32}$/i.test(image.revision) && md5(bytes) !== image.revision) throw new Error(`${project.folder}: исходник изменился во время скачивания.`);
        const converted = await toWebp(bytes);
        let target = webpName(image.name);
        const stem = target.replace(/\.webp$/i, ''); let suffix = 2;
        while (reserved.has(target.toLowerCase())) target = `${stem}-${suffix++}.webp`;
        reserved.add(target.toLowerCase());
        const base = resolve(directory, String(projectIndex));
        await mkdir(base, { recursive: true, mode: 0o700 });
        const sourceFile = resolve(base, `${imageIndex}.original`), file = resolve(base, `${imageIndex}.webp`);
        await writeFile(sourceFile, bytes, { mode: 0o600 });
        await writeFile(file, converted, { mode: 0o600 });
        const { width, height } = await sharp(converted).metadata();
        entry.images.push({ name: image.name, target, file, sourceFile, sourceMd5: md5(bytes), outputMd5: md5(converted), before: bytes.length, after: converted.length, width, height });
        await save(plan);
        console.log(`${project.folder}/${image.name}: ${bytes.length} → ${converted.length} байт; пиксели совпали.`);
      }
    }
    plan.prepared = true;
    await save(plan);
  } else if (mode === 'apply') {
    if (!plan?.prepared) throw new Error('Сначала выполни --prepare.');
    for (const entry of plan.projects) {
      if (entry.applied || !entry.images.length) continue;
      const project = await service.current(entry.project.folder, entry.project.version);
      const mapping = new Map(entry.images.map((image) => [image.name, image.target]));
      const order = project.images.map((image) => mapping.get(image.name) || image.name);
      const changes = [];
      for (const image of entry.images) {
        const bytes = await readFile(image.file);
        if (md5(bytes) !== image.outputMd5) throw new Error('Подготовленная копия повреждена. Диск не изменён.');
        changes.push({ name: image.name, target: image.target, bytes });
      }
      entry.receipt = await commitWebpImages({ disk, directory: child(plan.diskRoot, project.folder), project, changes,
        metadata: Buffer.from(serializeMetadata({ ...project, imageOrder: order }, project.folder)), retainOriginals: true,
        verifyUpload: async (path, bytes) => {
          const resource = await disk.resource(path, { fields: 'md5,size' });
          if (resource.md5 !== md5(bytes) || resource.size !== bytes.length) throw new Error('Диск вернул несовпадающую контрольную сумму WebP.');
        },
      });
      entry.applied = true;
      await save(plan);
      console.log(`Готово: ${project.folder}, ${changes.length} WebP. Старые ссылки пока работают.`);
    }
  } else if (mode === 'archive') {
    if (!plan?.prepared || plan.projects.some((entry) => entry.images.length && !entry.applied)) throw new Error('Сначала заверши --apply и публикацию сайта.');
    for (const entry of plan.projects) {
      if (!entry.images.length) continue;
      for (const image of entry.images) {
        if (image.archived) continue;
        const from = child(plan.diskRoot, entry.project.folder, image.name);
        const to = `${entry.receipt.archive}/${image.name}`;
        let resource;
        try { resource = await disk.resource(from, { fields: 'md5,size' }); }
        catch (error) {
          if (error.status !== 404) throw error;
          resource = await disk.resource(to, { fields: 'md5,size' });
          if (resource.md5 !== image.sourceMd5) throw new Error('Архивная копия не совпадает с исходником.');
          image.archived = true; await save(plan); continue;
        }
        if (resource.md5 !== image.sourceMd5) throw new Error(`${entry.project.folder}/${image.name}: исходник изменён, архивация остановлена.`);
        const output = await disk.resource(child(plan.diskRoot, entry.project.folder, image.target), { fields: 'md5' });
        if (output.md5 !== image.outputMd5) throw new Error('WebP изменён, оригинал оставлен на месте.');
        await disk.move(from, to);
        image.archived = true;
        await save(plan);
      }
      console.log(`Оригиналы сохранены: ${entry.project.folder}`);
    }
    plan.archivedAt = new Date().toISOString();
    await save(plan);
  } else throw new Error('Используй --prepare, --apply или --archive.');
  const images = plan.projects.flatMap((entry) => entry.images);
  console.log(JSON.stringify({ images: images.length, before: images.reduce((sum, image) => sum + image.before, 0), after: images.reduce((sum, image) => sum + image.after, 0), prepared: plan.prepared, applied: plan.projects.filter((entry) => entry.applied).length, archived: images.filter((image) => image.archived).length }));
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await convertPortfolioWebp(process.cwd(), process.argv[2]?.replace(/^--/, '')); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
