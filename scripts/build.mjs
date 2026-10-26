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

function brandMarkup(config, hero = false) {
  const [first, ...rest] = (config.brand || 'Ferg Design').trim().split(/\s+/);
  if (hero) return `<span>${e(first)}</span>${rest.length ? ` <span class="gradient-text">${e(rest.join(' '))}</span>` : ''}`;
  return `${e(first)}${rest.length ? ` <span>${e(rest.join(' '))}</span>` : ''}`;
}

function layout(config, { title, content, base = './', page = 'home' }) {
  const asset = (name) => `${base}${name}?v=${encodeURIComponent(config.version || '1')}`;
  return `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="portfolio-version" content="${e(config.version || '')}">
<meta name="portfolio-source" content="${e(config.publicUrl || '')}">
<title>${e(title)}</title><meta name="description" content="${e(config.description)}">
<link rel="icon" href="${asset('favicon.svg')}" type="image/svg+xml">
<link rel="stylesheet" href="${asset('style.css')}"><script src="${asset('app.js')}" defer></script>
<script src="${asset('media.js')}" type="module"></script>
<script src="${asset('motion.js')}" type="module"></script>
</head><body id="top" data-page="${page}">
<div class="scroll-progress" aria-hidden="true"></div>
<a class="skip-link" href="#main">К содержимому</a>
<header class="header"><a class="brand" href="${base}${pageVersion(config)}" aria-label="${e(config.brand || 'Ferg Design')} — главная">${brandMarkup(config)}</a><nav aria-label="Основная навигация"><a class="nav-link" href="${base}${pageVersion(config)}#works">Работы <span aria-hidden="true">↗</span></a></nav></header>
<main id="main">${content}</main>
<noscript><p>Для загрузки изображений нужен JavaScript. <a href="${e(config.publicUrl)}">Посмотреть работы на Яндекс Диске</a></p></noscript>
<footer><a class="footer-brand" href="${base}${pageVersion(config)}#top">${brandMarkup(config)}</a><a class="footer-top" href="#top">Наверх <span aria-hidden="true">↑</span></a></footer>
<dialog id="lightbox" aria-label="Просмотр изображения"><button class="close-viewer" aria-label="Закрыть изображение"><span>Закрыть</span> ×</button><p class="viewer-status" role="status" hidden></p><a class="viewer-source" target="_blank" rel="noopener noreferrer" hidden>Открыть папку на Диске ↗</a><img alt="" referrerpolicy="no-referrer"></dialog>
</body></html>`;
}

function remoteImage(image, title, { cover = false } = {}) {
  const content = `<img class="remote-image" alt="${e(title)} — ${e(image.name)}" decoding="async" referrerpolicy="no-referrer"><span class="media-status" role="status">Загрузка изображения…</span>`;
  return `<${cover ? 'div' : 'figure'} class="${cover ? 'cover' : 'remote-figure'} remote-media" data-disk-path="${e(image.path)}" data-disk-revision="${e(image.revision)}" data-disk-mode="${cover ? 'preview' : 'full'}">${cover ? content : `<button class="image-button" data-disk-full="${e(image.path)}" aria-label="Увеличить: ${e(image.name)}">${content}</button><div class="media-actions" hidden><button class="media-retry" type="button">Повторить загрузку</button><a class="media-source" target="_blank" rel="noopener noreferrer">Открыть папку на Диске ↗</a></div>`}</${cover ? 'div' : 'figure'}>`;
}

export function renderHome(config, snapshot) {
  const categories = [...new Set(snapshot.projects.map((p) => p.category).filter(Boolean))];
  const filters = categories.length ? `<div class="filters" role="group" aria-label="Категория работ"><button class="filter active" data-filter="" aria-pressed="true">Все работы</button>${categories.map((category) => `<button class="filter" data-filter="${e(category)}" aria-pressed="false">${e(category)}</button>`).join('')}</div>` : '';
  const cards = snapshot.projects.map((project, index) => `<article class="card" data-reveal data-category="${e(project.category)}"><a class="card-link" href="./projects/${project.slug}/${pageVersion(config)}">
<div class="card-media">${project.cover ? remoteImage(project.cover, project.title, { cover: true }) : '<div class="cover"><div class="placeholder"><span aria-hidden="true">＋</span><span>Нет материалов</span></div></div>'}<span class="card-number">/ ${String(index + 1).padStart(2, '0')}</span>${project.category ? `<span class="card-tag">${e(project.category)}</span>` : ''}<span class="card-cursor" aria-hidden="true">Открыть<br>↗</span></div>
<div class="card-caption"><div>${project.category || project.year ? `<p>${e([project.category, project.year].filter(Boolean).join(' / '))}</p>` : ''}<h2>${e(project.title)}</h2></div><span class="card-arrow" aria-hidden="true">↗</span></div>
</a></article>`).join('');
  const date = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(new Date(snapshot.syncedAt));
  return layout(config, { title: config.title, content: `<section class="intro"><div class="hero-ambient" aria-hidden="true"></div><p class="hero-label">Портфолио</p><h1 class="hero-title">${brandMarkup(config, true)}</h1><a class="hero-cta" href="#works">Смотреть работы <span aria-hidden="true">↗</span></a></section>
<section id="works" class="works-section" aria-label="Работы"><div class="section-heading" data-reveal><h2>Работы<span class="count">${String(snapshot.projects.length).padStart(2, '0')}</span></h2><span class="section-label">Портфолио / ${new Date(snapshot.syncedAt).getUTCFullYear()}</span></div>${filters}<div class="grid">${cards}</div><p class="empty-filter" hidden>В этой категории пока нет работ.</p>${!snapshot.projects.length ? '<div class="empty-state"><h2>Здесь будут работы</h2><p>Новые проекты скоро появятся.</p></div>' : ''}</section>
<aside class="sync-note"><span class="status-dot" aria-hidden="true"></span><span>Обновлено ${e(date)} МСК</span><a href="./sync-report.html${pageVersion(config)}">Информация о работах ↗</a></aside>` });
}

export function renderProject(config, project, next) {
  const base = '../../';
  const description = project.description.split(/\n\s*\n/).filter(Boolean).map((p) => `<p>${e(p).replaceAll('\n', '<br>')}</p>`).join('');
  const gallery = project.images.map((image) => remoteImage(image, project.title)).join('');
  return layout(config, { title: `${project.title} — ${config.title}`, base, page: 'project', content: `<a class="back" href="${base}${pageVersion(config)}#works">← Все работы</a><section class="project-intro"><div><p class="eyebrow">${e([project.category, project.year].filter(Boolean).join(' / ') || 'Проект')}</p><h1>${e(project.title)}</h1></div>${description ? `<div class="description">${description}</div>` : '<p class="muted">Описание пока не добавлено.</p>'}</section><section class="gallery" aria-label="Изображения проекта">${gallery || '<div class="empty-state"><h2>Материалы скоро появятся</h2><p>Проект готовится к публикации.</p></div>'}</section>${next ? `<a class="next-project" href="../${next.slug}/${pageVersion(config)}" data-reveal><span>Следующий проект</span><strong>${e(next.title)}<span aria-hidden="true">↗</span></strong></a>` : ''}` });
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
      await writeFile(page, renderProject(config, project, snapshot.projects[index + 1]));
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
