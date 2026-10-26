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

function layout(config, { title, content, base = './', page = 'home' }) {
  return `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="portfolio-version" content="${e(config.version || '')}">
<meta name="portfolio-source" content="${e(config.publicUrl || '')}">
<title>${e(title)}</title><meta name="description" content="${e(config.description)}">
<link rel="icon" href="${base}favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${base}style.css"><script src="${base}app.js" defer></script>
<script src="${base}media.js" type="module"></script>
<script src="${base}motion.js" type="module"></script>
</head><body id="top" data-page="${page}">
<div class="scroll-progress" aria-hidden="true"></div>
<a class="skip-link" href="#main">К содержимому</a>
<header class="header"><a class="brand" href="${base}" aria-label="${e(config.brand || config.title)} — главная"><span class="brand-mark" aria-hidden="true">f<span>.</span></span><span>${e(config.brand || 'ПОРТФОЛИО')}<small>VISUAL DESIGNER</small></span></a><nav aria-label="Основная навигация"><a class="nav-link" href="${base}#works">Работы<span aria-hidden="true">↗</span></a><span class="nav-note">Независимый дизайн</span><a class="nav-index" href="${base}#top" aria-label="К началу страницы">[ F / D ]</a></nav></header>
<main id="main">${content}</main>
<noscript><p>Для загрузки изображений нужен JavaScript. <a href="${e(config.publicUrl)}">Посмотреть работы на Яндекс Диске</a></p></noscript>
<footer><a class="footer-brand" href="${base}#top">${e(config.brand || 'ПОРТФОЛИО')}<span>✳</span></a><span>Идея. Форма. Характер.</span><a class="footer-top" href="#top">Наверх <span aria-hidden="true">↑</span></a></footer>
<dialog id="lightbox" aria-label="Просмотр изображения"><button class="close-viewer" aria-label="Закрыть изображение"><span>Закрыть</span> ×</button><p class="viewer-status" role="status" hidden></p><a class="viewer-source" target="_blank" rel="noopener noreferrer" hidden>Открыть папку на Диске ↗</a><img alt="" referrerpolicy="no-referrer"></dialog>
</body></html>`;
}

function kineticMark() {
  return `<div class="hero-art" aria-hidden="true"><span class="art-corner corner-tl">+</span><span class="art-corner corner-tr">+</span><span class="art-corner corner-bl">+</span><span class="art-corner corner-br">+</span><span class="art-label">FIG. 001 / VISUAL ENERGY</span><svg class="kinetic-mark" viewBox="0 0 400 400" fill="none"><defs><path id="orbit-text" d="M200 24a176 176 0 1 1-.1 0"/></defs><circle class="orbit-line" cx="200" cy="200" r="155"/><circle class="orbit-line dashed" cx="200" cy="200" r="122"/><g class="orbit-type"><text><textPath href="#orbit-text" textLength="1105" lengthAdjust="spacing">FORM FOLLOWS FEELING / MAKE IT LOUD / FORM FOLLOWS FEELING / MAKE IT LOUD / </textPath></text></g><g class="star"><path d="M176 60h48l-5 89 59-67 34 34-67 59 89-5v48l-89-5 67 59-34 34-59-67 5 89h-48l5-89-59 67-34-34 67-59-89 5v-48l89 5-67-59 34-34 59 67z" fill="currentColor"/></g><circle cx="200" cy="194" r="30" fill="#101010"/><path d="M190 180h25v7h-17v6h14v7h-14v13h-8z" fill="currentColor"/><circle class="orbit-dot" cx="355" cy="200" r="4" fill="currentColor"/></svg><span class="art-coordinate">VECTOR / 360°</span><span class="art-caption">Порядок внутри хаоса.</span></div>`;
}

function remoteImage(image, title, { cover = false } = {}) {
  const content = `<img class="remote-image" alt="${e(title)} — ${e(image.name)}" decoding="async" referrerpolicy="no-referrer"><span class="media-status" role="status">Загрузка изображения…</span>`;
  return `<${cover ? 'div' : 'figure'} class="${cover ? 'cover' : 'remote-figure'} remote-media" data-disk-path="${e(image.path)}" data-disk-revision="${e(image.revision)}" data-disk-mode="${cover ? 'preview' : 'full'}">${cover ? content : `<button class="image-button" data-disk-full="${e(image.path)}" aria-label="Увеличить: ${e(image.name)}">${content}</button><div class="media-actions" hidden><button class="media-retry" type="button">Повторить загрузку</button><a class="media-source" target="_blank" rel="noopener noreferrer">Открыть папку на Диске ↗</a></div>`}</${cover ? 'div' : 'figure'}>`;
}

export function renderHome(config, snapshot) {
  const categories = [...new Set(snapshot.projects.map((p) => p.category).filter(Boolean))];
  const filters = categories.length ? `<div class="filters" role="group" aria-label="Категория работ"><button class="filter active" data-filter="" aria-pressed="true">Все работы</button>${categories.map((category) => `<button class="filter" data-filter="${e(category)}" aria-pressed="false">${e(category)}</button>`).join('')}</div>` : '';
  const cards = snapshot.projects.map((project, index) => `<article class="card" data-reveal data-category="${e(project.category)}"><a class="card-link" href="./projects/${project.slug}/">
<div class="card-media">${project.cover ? remoteImage(project.cover, project.title, { cover: true }) : '<div class="cover"><div class="placeholder"><span aria-hidden="true">＋</span><span>Нет материалов</span></div></div>'}<span class="card-number">/ ${String(index + 1).padStart(2, '0')}</span><span class="card-tag">${e(project.category || 'VISUAL DESIGN')}</span><span class="card-cursor" aria-hidden="true">Смотреть<br>↗</span></div>
<div class="card-caption"><div><p>${e([project.category || 'Визуальный дизайн', project.year].filter(Boolean).join(' / '))}</p><h2>${e(project.title)}</h2></div><span class="card-arrow" aria-hidden="true">↗</span></div>
</a></article>`).join('');
  const date = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(new Date(snapshot.syncedAt));
  const ticker = '<span>ИДЕЯ</span><b>✳</b><span>ФОРМА</span><b>✳</b><span>ХАРАКТЕР</span><b>✳</b><span>ДВИЖЕНИЕ</span><b>✳</b>';
  return layout(config, { title: config.title, content: `<section class="intro" ><div class="intro-main"><p class="eyebrow hero-eyebrow"><span class="status-dot"></span> Портфолио / Визуальный дизайн</p><h1 class="hero-title"><span class="hero-line"><span>ДЕЛАЮ</span></span><span class="hero-line"><span>ГРОМКО<span class="hero-period">.</span></span></span><span class="sr-only"> Визуальный дизайн с характером.</span></h1><div class="hero-bottom"><p class="intro-text">${e(config.description)}</p><a class="hero-cta magnetic" href="#works"><span>Смотреть работы</span><span class="cta-arrow" aria-hidden="true">↘</span></a></div></div>${kineticMark()}<div class="hero-foot"><span>ВИЗУАЛ, КОТОРЫЙ ОСТАЁТСЯ В ГОЛОВЕ.</span><a href="#works">Листай вниз <span aria-hidden="true">↓</span></a><span>[ ПРОЕКТОВ: ${String(snapshot.projects.length).padStart(2, '0')} ]</span></div></section>
<div class="marquee" aria-label="Идея. Форма. Характер. Движение."><div class="marquee-track" aria-hidden="true"><div>${ticker}</div><div>${ticker}</div></div></div>
<section id="works" class="works-section" aria-label="Работы"><div class="section-heading" data-reveal><div><p class="eyebrow"><span class="red">/ 01</span> &nbsp; SELECTED WORKS</p><h2>Меньше слов.<br><span>Больше визуала.</span></h2></div><div class="section-meta"><span class="works-count">${String(snapshot.projects.length).padStart(2, '0')}</span><span>ПРОЕКТЫ / ПОРТФОЛИО</span></div></div>${filters}<div class="grid">${cards}</div><p class="empty-filter" hidden>В этой категории пока нет работ.</p>${!snapshot.projects.length ? '<div class="empty-state"><h2>Здесь будут работы</h2><p>Новые проекты скоро появятся.</p></div>' : ''}</section>
<section class="closing" data-reveal><p class="eyebrow">НЕ ПРОСТО КАРТИНКА. ОЩУЩЕНИЕ.</p><p class="closing-title">У КАЖДОЙ ИДЕИ<br>ЕСТЬ <em>ХАРАКТЕР<span>↗</span></em></p><a href="#top" class="closing-link">Вернуться к началу <span aria-hidden="true">↑</span></a></section>
<aside class="sync-note"><span class="status-dot" aria-hidden="true"></span><span>Обновлено ${e(date)} МСК</span><a href="./sync-report.html">Информация о работах ↗</a></aside>` });
}

export function renderProject(config, project, next) {
  const base = '../../';
  const description = project.description.split(/\n\s*\n/).filter(Boolean).map((p) => `<p>${e(p).replaceAll('\n', '<br>')}</p>`).join('');
  const gallery = project.images.map((image) => remoteImage(image, project.title)).join('');
  return layout(config, { title: `${project.title} — ${config.title}`, base, page: 'project', content: `<a class="back" href="${base}#works">← Все работы</a><section class="project-intro"><div><p class="eyebrow"><span class="red">/ PROJECT</span> &nbsp; ${e([project.category, project.year].filter(Boolean).join(' / ') || 'ВИЗУАЛЬНЫЙ ДИЗАЙН')}</p><h1>${e(project.title)}<span class="red">.</span></h1></div>${description ? `<div class="description">${description}</div>` : '<p class="muted">Описание пока не добавлено.</p>'}</section><section class="gallery" aria-label="Изображения проекта">${gallery || '<div class="empty-state"><h2>Материалы скоро появятся</h2><p>Проект готовится к публикации.</p></div>'}</section>${next ? `<a class="next-project" href="../${next.slug}/" data-reveal><span>Дальше — больше / Следующий проект</span><strong>${e(next.title)}<span aria-hidden="true">↗</span></strong></a>` : ''}` });
}

function renderReport(config, snapshot) {
  return layout(config, { title: `Отчёт о загрузке — ${config.title}`, content: `<a class="back" href="./">← К портфолио</a><section class="report"><p class="eyebrow">Проверка подключения</p><h1>Отчёт о загрузке</h1><p>Папка: <strong>${e(snapshot.sourceName)}</strong></p><p>Последняя успешная синхронизация: <time datetime="${e(snapshot.syncedAt)}">${e(snapshot.syncedAt)}</time></p><p>Проектов: ${snapshot.projects.length} · Изображений: ${snapshot.projects.reduce((n, p) => n + p.images.length, 0)}</p>${snapshot.warnings.length ? `<h2>Что можно дополнить</h2><ul>${snapshot.warnings.map((w) => `<li>${e(w)}</li>`).join('')}</ul>` : '<p>Все проекты загружены без замечаний.</p>'}<p class="muted">Этот отчёт отражает последнюю сборку. Изменения на Диске появятся после следующего обновления сайта.</p></section>` });
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
