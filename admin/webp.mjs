import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { AdminError, component } from './disk.mjs';
import { hash, natural } from '../scripts/content.mjs';

export const webpName = (name) => component(name.replace(/\.[^.]+$/, '.webp'));
export const fileRevision = (files) => hash(JSON.stringify(files.filter((file) => file.type === 'file').map((file) => [file.name, file.md5 || file.revision || file.modified || '', file.size || 0]).sort((a, b) => natural(a[0], b[0]))));

export async function toWebp(bytes) {
  try {
    const input = sharp(bytes, { animated: true });
    const before = await input.metadata();
    if (!['png', 'jpeg', 'webp', 'gif', 'avif', 'heif'].includes(before.format)) throw new Error('Unsupported format');
    if (before.format === 'webp') return bytes;
    if (before.depth !== 'uchar') throw new AdminError('WebP поддерживает 8 бит на канал. Этот файл оставлен без изменений, чтобы не терять глубину цвета.');
    const output = await input.keepMetadata().webp({ lossless: true, exact: true, effort: 4 }).toBuffer();
    const after = await sharp(output, { animated: true }).metadata();
    if (before.width !== after.width || before.height !== after.height || (before.pages || 1) !== (after.pages || 1)) throw new Error('Dimensions changed');
    const pixels = async (value) => hash(await sharp(value, { animated: true }).ensureAlpha().raw().toBuffer());
    if (await pixels(bytes) !== await pixels(output)) throw new AdminError('Проверка пикселей после WebP не совпала. Исходный файл оставлен без изменений.');
    return output;
  } catch (error) {
    if (error instanceof AdminError) throw error;
    throw new AdminError('Содержимое файла не соответствует поддерживаемому изображению или его не удалось преобразовать в WebP.');
  }
}

// Stage first, check external edits, then swap files. Originals remain recoverable.
export async function commitWebpImages({ disk, directory, project, changes, metadata, retainOriginals = false, verifyUpload }) {
  const before = (await disk.list(directory)).items.filter((file) => file.type === 'file');
  if (fileRevision(before) !== project.version) throw new AdminError('Работа изменилась на Диске. Обнови её перед конвертацией.', 409);
  const id = randomUUID();
  const archive = `${directory}/.webp-originals-${id}`;
  const stages = changes.map((change, index) => ({ ...change, stage: `${directory}/.webp-stage-${id}-${index}` }));
  const stageNames = new Set(stages.map((item) => item.stage.split('/').at(-1)));
  const moved = [], activated = [];
  const remaining = new Set(stages.map((item) => item.stage));
  if (new Set(changes.map((change) => change.target.toLowerCase())).size !== changes.length) throw new AdminError('Совпадают имена новых WebP-файлов.', 409);
  let metadataAttempted = false;
  for (const change of changes) {
    component(change.name); component(change.target);
    if (before.some((file) => file.name.toLowerCase() === change.target.toLowerCase() && file.name !== change.name)) throw new AdminError('Имя WebP уже занято другим изображением.', 409);
  }
  try {
    for (const item of stages) { await disk.upload(item.stage, item.bytes, false); if (verifyUpload) await verifyUpload(item.stage, item.bytes); }
    const current = (await disk.list(directory)).items.filter((file) => file.type === 'file' && !stageNames.has(file.name));
    if (fileRevision(current) !== fileRevision(before)) throw new AdminError('Работа изменилась во время конвертации. Исходники сохранены, обнови данные.', 409);
    await disk.mkdir(archive);
    for (const file of before.filter((file) => /^info\.(txt|docx)$/i.test(file.name) || (!retainOriginals && changes.some((change) => change.name === file.name)))) {
      const from = `${directory}/${file.name}`, to = `${archive}/${file.name}`;
      await disk.move(from, to); moved.push({ from, to });
    }
    for (const item of stages) {
      await disk.move(item.stage, `${directory}/${item.target}`);
      remaining.delete(item.stage);
      activated.push(`${directory}/${item.target}`);
    }
    metadataAttempted = true;
    await disk.upload(`${directory}/info.txt`, metadata, false);
    return { archive, images: changes.map(({ name, target }) => ({ name, target })), retainedOriginals: retainOriginals };
  } catch (error) {
    const recovery = [];
    if (metadataAttempted) { try { await disk.trash(`${directory}/info.txt`); } catch (failure) { if (failure.status !== 404) recovery.push(failure); } }
    for (const path of activated.reverse()) { try { await disk.trash(path); } catch (failure) { if (failure.status !== 404) recovery.push(failure); } }
    for (const move of moved.reverse()) { try { await disk.move(move.to, move.from, true); } catch (failure) { recovery.push(failure); } }
    if (recovery.length) throw new AdminError(`Операция прервана. Исходники находятся в ${archive}; автоматическое восстановление не завершено. Обнови данные перед повтором.`, 502);
    throw error;
  } finally {
    for (const path of remaining) { try { await disk.trash(path); } catch { /* Absent or hidden temporary files cannot enter the portfolio. */ } }
  }
}
