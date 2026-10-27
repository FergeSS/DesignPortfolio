import { readFile, readdir, writeFile, mkdir, cp, rm, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { escapeHtml as e, hash } from './content.mjs';

async function siteVersion(root, config, snapshot) {
  const sources = [];
  async function walk(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = resolve(path, entry.name);
      if (entry.isDirectory()) await walk(file);
      else sources.push([file.slice(root.length), hash(await readFile(file))]);
    }
  }
  await walk(resolve(root, 'src'));
  // Ignore the time of the check: unchanged content must not reload open pages.
  const { syncedAt, ...content } = snapshot;
  return hash(JSON.stringify({ config, content, sources, renderer: hash(await readFile(new URL(import.meta.url))) }));
}

const pageVersion = (config) => config.version ? `?v=${encodeURIComponent(config.version.slice(0, 12))}` : '';

const pad = (n) => String(n).padStart(2, '0');
const icon = (base, name) => `<img class="icon" src="${base}assets/${name}.svg" alt="" width="20" height="20" aria-hidden="true">`;
const format = (image) => (image?.name.split('.').at(-1) || '—').toUpperCase();

function header(config, base) {
  const contacts = config.contacts || {};
  return `<header class="header"><a class="brand" href="${base}${pageVersion(config)}" aria-label="${e(config.brand || 'Ferg Design')} — главная">${e(config.brand || 'Ferg Design')}</a>
<details class="contact"><summary class="contact-trigger glass">Контакт<span class="chevron-closed">${icon(base, 'down')}</span><span class="chevron-open">${icon(base, 'up')}</span></summary><nav class="contact-menu glass" aria-label="Контакты">
${[['Почта', contacts.email ? `mailto:${contacts.email}` : 'mailto:sasha-uhnov@yandex.ru'], ['ТГ', contacts.telegram || 'https://t.me/FergeS22'], ['ВК', contacts.vk || 'https://vk.ru/myidistop1']].map(([label, url]) => `<a href="${e(url)}"${label === 'Почта' ? '' : ' target="_blank" rel="noopener noreferrer"'}>${label}${icon(base, 'external')}</a>`).join('')}</nav></details></header>`;
}

function layout(config, { title, content, base = './', page = 'home', atmosphere = '' }) {
  const asset = (name) => `${base}${name}?v=${encodeURIComponent(config.version || '1')}`;
  return `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="portfolio-version" content="${e(config.version || '')}"><meta name="portfolio-source" content="${e(config.publicUrl || '')}">
<title>${e(title)}</title><meta name="description" content="${e(config.description)}">
<link rel="icon" href="${asset('favicon.svg')}" type="image/svg+xml">
<link rel="preload" href="${base}fonts/onest-regular.ttf" as="font" type="font/ttf" crossorigin>
<link rel="stylesheet" href="${asset('style.css')}"><script src="${asset('app.js')}" defer></script>
<script src="${asset('media.js')}" type="module"></script><script src="${asset('motion.js')}" type="module"></script><script src="${asset('portfolio-ui.js')}" type="module"></script>
</head><body id="top" data-page="${page}">
<a class="skip-link" href="#main">К содержимому</a>${atmosphere ? `<div class="page-atmosphere" aria-hidden="true"><img src="${base}assets/${atmosphere}.svg" alt=""></div>` : ''}
<div class="shell">${header(config, base)}<main id="main">${content}</main></div>
<noscript><p>Для загрузки изображений нужен JavaScript. <a href="${e(config.publicUrl)}">Посмотреть работы на Яндекс Диске</a></p></noscript>
<dialog id="lightbox" aria-label="Просмотр изображения"><div class="viewer-shell"><div class="viewer-header"><p class="viewer-title"></p><button class="close-viewer pill glass" type="button">${icon(base, 'close')}<span>Закрыть</span></button></div><div class="viewer-stage"><img class="viewer-image" alt="" referrerpolicy="no-referrer"><p class="viewer-status" role="status" hidden></p><a class="viewer-source" target="_blank" rel="noopener noreferrer" hidden>Открыть папку на Диске ↗</a></div><div class="viewer-info"><span class="viewer-count"></span><span class="viewer-dimensions"></span></div><div class="viewer-navigation" hidden><button class="viewer-prev pill glass" aria-label="Предыдущее изображение">←</button><button class="viewer-next pill glass" aria-label="Следующее изображение">→</button></div></div></dialog>
</body></html>`;
}

function remoteImage(image, title, { cover = false, extra = '', attrs = '' } = {}) {
  return `<div class="${cover ? 'cover' : 'remote-figure'} remote-media ${extra}" data-disk-path="${e(image.path)}" data-disk-revision="${e(image.revision)}" data-disk-mode="${cover ? 'preview' : 'full'}" ${attrs}><img class="remote-image" alt="${e(title)} — ${e(image.name)}" decoding="async" referrerpolicy="no-referrer"><span class="media-status" role="status">Загрузка изображения…</span>${cover ? '' : '<div class="media-actions" hidden><button class="media-retry" type="button">Повторить загрузку</button><a class="media-source" target="_blank" rel="noopener noreferrer">Открыть папку на Диске ↗</a></div>'}</div>`;
}

export function renderHome(config, snapshot) {
  const categories = [...new Set(snapshot.projects.map((p) => p.category).filter(Boolean))];
  const filters = categories.length ? `<div class="filters" role="group" aria-label="Категория работ"><button class="filter active" data-filter="" aria-pressed="true">Все работы</button>${categories.map((category) => `<button class="filter" data-filter="${e(category)}" aria-pressed="false">${e(category)}</button>`).join('')}</div>` : '';
  const cards = snapshot.projects.map((project) => `<article class="card glass" data-reveal data-category="${e(project.category)}"><a class="card-link" href="./projects/${project.slug}/${pageVersion(config)}">${project.cover ? remoteImage(project.cover, project.title, { cover: true }) : '<div class="cover placeholder">Нет материалов</div>'}<div class="card-caption"><h2>${e(project.title)}</h2>${icon('./', 'arrow')}</div></a></article>`).join('');
  return layout(config, { title: config.title, atmosphere: 'works-atmosphere', content: `<section class="hero" aria-label="Ferg Design"><h1 class="sr-only">${e(config.brand || 'Ferg Design')}</h1><div class="hero-art" role="img" aria-label="Глянцевые буквы FG"><img class="hero-letter hero-letter-f" src="./assets/fg.png" alt="" aria-hidden="true" width="1672" height="941" fetchpriority="high"><img class="hero-letter hero-letter-g" src="./assets/fg.png" alt="" aria-hidden="true" width="1672" height="941" fetchpriority="high"></div><div class="hero-atmosphere" aria-hidden="true"><img src="./assets/hero-atmosphere.svg" alt=""></div><div class="hero-blend" aria-hidden="true"></div></section>
<section id="works" class="works-section" aria-label="Работы"><div class="section-heading"><h2>Работы</h2><span class="count">${pad(snapshot.projects.length)}</span></div>${filters}<div class="grid">${cards}</div><p class="empty-filter" hidden>В этой категории пока нет работ.</p>${!snapshot.projects.length ? '<div class="empty-state"><h2>Здесь будут работы</h2><p>Новые проекты скоро появятся.</p></div>' : ''}</section>` });
}

export function renderProject(config, project, next, index = 0, total = 1) {
  const base = '../../';
  const description = project.description.split(/\n\s*\n/).filter(Boolean).map((p) => `<p>${e(p).replaceAll('\n', '<br>')}</p>`).join('');
  const images = [...project.images].sort((a, b) => Number(b.path === project.cover?.path) - Number(a.path === project.cover?.path));
  const gallery = images.map((image, i) => remoteImage(image, project.title, { extra: 'gallery-frame', attrs: `data-gallery-index="${i}" data-name="${e(image.name)}" data-format="${e(format(image))}"${i ? ' hidden' : ''}` })).join('');
  const thumbnails = images.map((image, i) => `<button class="thumbnail${i ? '' : ' selected'}" data-select-image="${i}" aria-label="Изображение ${i + 1}: ${e(image.name)}" aria-pressed="${!i}">${remoteImage(image, project.title, { cover: true })}</button>`).join('');
  return layout(config, { title: `${project.title} — ${config.title}`, base, page: 'project', atmosphere: `project-atmosphere-${index % 3 + 1}`, content: `<div class="project-navigation"><a class="back pill glass" href="${base}${pageVersion(config)}#works">${icon(base, 'back')}К работам</a><span class="caption">${pad(index + 1)} / ${pad(total)}</span></div><div class="project-heading"><h1>${e(project.title)}</h1><p class="project-dimensions" data-image-summary>${images.length ? format(images[0]) : ''}</p></div>
<section class="gallery" aria-label="Изображения проекта" data-project-title="${e(project.title)}">${gallery || '<div class="empty-state"><h2>Материалы скоро появятся</h2></div>'}</section>${images.length ? `<div class="gallery-controls"><div class="image-selection"><div class="thumbnails" aria-label="Выбрать изображение">${thumbnails}</div><span class="caption" data-image-count>01 / ${pad(images.length)}</span></div><button class="expand-viewer pill glass" type="button">${icon(base, 'expand')}На весь экран</button></div>` : ''}
<section class="project-information" aria-label="О работе"><div class="project-description"><p class="caption">${description ? 'О работе' : 'Файл'}</p><div class="description">${description || `<p>${e(images[0]?.name || 'Материалы скоро появятся')}</p>`}</div></div><dl class="file-information"><div><dt>Формат</dt><dd data-image-format>${format(images[0])}</dd></div><div><dt>Размер</dt><dd data-image-dimensions>—</dd></div><div><dt>Изображений</dt><dd>${pad(images.length)}</dd></div></dl></section>
${next ? `<a class="next-project glass" href="../${next.slug}/${pageVersion(config)}"><div class="next-label"><span class="caption">Следующая работа</span><strong>${e(next.title)}</strong></div><div class="next-preview">${next.cover ? remoteImage(next.cover, next.title, { cover: true }) : ''}${icon(base, 'arrow')}</div></a>` : ''}` });
}

function renderReport(config, snapshot) {
  return layout(config, { title: `Отчёт о загрузке — ${config.title}`, content: `<a class="back" href="./${pageVersion(config)}">← К портфолио</a><section class="report"><p class="eyebrow">Проверка подключения</p><h1>Отчёт о загрузке</h1><p>Папка: <strong>${e(snapshot.sourceName)}</strong></p><p>Последняя успешная синхронизация: <time datetime="${e(snapshot.syncedAt)}">${e(snapshot.syncedAt)}</time></p><p>Проектов: ${snapshot.projects.length} · Изображений: ${snapshot.projects.reduce((n, p) => n + p.images.length, 0)}</p>${snapshot.warnings.length ? `<h2>Что можно дополнить</h2><ul>${snapshot.warnings.map((w) => `<li>${e(w)}</li>`).join('')}</ul>` : '<p>Все проекты загружены без замечаний.</p>'}<p class="muted">Этот отчёт отражает последнюю сборку. Изменения на Диске появятся после следующего обновления сайта.</p></section>` });
}

export async function buildPortfolio(root = process.cwd(), { skipUnchanged = false } = {}) {
  const config = JSON.parse(await readFile(resolve(root, 'portfolio.config.json'), 'utf8'));
  let snapshot;
  try { snapshot = JSON.parse(await readFile(resolve(root, '.cache/portfolio.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') throw new Error('Сначала запустите npm run sync, чтобы загрузить работы с Диска.'); throw error; }
  if (snapshot.storage !== 'yandex-direct' || snapshot.schemaVersion !== 2) throw new Error('Нужен новый каталог с прямыми ссылками на Диск. Выполните npm run sync.');
  const version = await siteVersion(root, config, snapshot);
  if (skipUnchanged) {
    try {
      const previous = JSON.parse(await readFile(resolve(root, 'dist/site-version.json'), 'utf8'));
      await readFile(resolve(root, 'dist/index.html'));
      if (previous.version === version) return { ...snapshot, changed: false, version };
    } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  }
  config.version = version;
  config.publicUrl = snapshot.publicUrl;
  const stage = resolve(root, `.dist-${process.pid}`);
  const dist = resolve(root, 'dist');
  const backup = resolve(root, `.dist-backup-${process.pid}`);
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  try {
    await cp(resolve(root, 'src'), stage, { recursive: true });
    await writeFile(resolve(stage, 'index.html'), renderHome(config, snapshot));
    await writeFile(resolve(stage, 'sync-report.html'), renderReport(config, snapshot));
    await writeFile(resolve(stage, '404.html'), layout(config, { title: 'Страница не найдена', content: '<section class="intro"><h1>Страница не найдена</h1><p>Вернись на главную через адрес сайта.</p></section>' }));
    await writeFile(resolve(stage, '.nojekyll'), '');
    await writeFile(resolve(stage, 'portfolio.json'), JSON.stringify(snapshot, null, 2));
    await writeFile(resolve(stage, 'site-version.json'), JSON.stringify({ version, projects: snapshot.projects.map((p) => p.slug) }));
    for (const [index, project] of snapshot.projects.entries()) {
      const page = resolve(stage, 'projects', project.slug, 'index.html');
      await mkdir(dirname(page), { recursive: true });
      await writeFile(page, renderProject(config, project, snapshot.projects.length > 1 ? snapshot.projects[(index + 1) % snapshot.projects.length] : null, index, snapshot.projects.length));
    }
    let hadDist = false;
    try { await rename(dist, backup); hadDist = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await rename(stage, dist); }
    catch (error) { if (hadDist) await rename(backup, dist); throw error; }
    await rm(backup, { recursive: true, force: true });
  } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
  return { ...snapshot, changed: true, version };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const data = await buildPortfolio(); console.log(`Сайт собран в dist/. Проектов: ${data.projects.length}.`); }
  catch (error) { console.error(`Ошибка сборки: ${error.message}`); process.exitCode = 1; }
}
