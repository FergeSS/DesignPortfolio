import { readFile, readdir, writeFile, mkdir, copyFile, cp, rm, rename } from 'node:fs/promises';
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
<title>${e(title)}</title><meta name="description" content="${e(config.description)}">
<link rel="icon" href="${base}favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${base}style.css"><script src="${base}app.js" defer></script>
</head><body data-page="${page}">
<a class="skip-link" href="#main">К содержимому</a>
<header class="header"><a class="brand" href="${base}"><span class="brand-mark" aria-hidden="true">д.</span>${e(config.title)}</a><a class="nav-link" href="${base}#works">Работы <span aria-hidden="true">↗</span></a></header>
<main id="main">${content}</main>
<footer><span>${e(config.title)}</span><span>Работы, собранные в одном месте.</span></footer>
<dialog id="lightbox" aria-label="Просмотр изображения"><button class="close-viewer" aria-label="Закрыть изображение">Закрыть ×</button><img alt=""></dialog>
</body></html>`;
}

export function renderHome(config, snapshot) {
  const categories = [...new Set(snapshot.projects.map((p) => p.category).filter(Boolean))];
  const filters = categories.length ? `<div class="filters" role="group" aria-label="Категория работ"><button class="filter active" data-filter="" aria-pressed="true">Все работы</button>${categories.map((category) => `<button class="filter" data-filter="${e(category)}" aria-pressed="false">${e(category)}</button>`).join('')}</div>` : '';
  const cards = snapshot.projects.map((project, index) => `<article class="card" data-category="${e(project.category)}"><a class="card-link" href="./projects/${project.slug}/">
<div class="cover">${project.cover ? `<img src="./${e(project.cover.src)}" alt="${e(project.title)} — обложка" ${index > 2 ? 'loading="lazy"' : ''}>` : '<div class="placeholder"><span aria-hidden="true">＋</span><span>Нет материалов</span></div>'}<span class="card-number">${String(index + 1).padStart(2, '0')}</span></div>
<div class="card-caption"><div><h2>${e(project.title)}</h2><p>${e([project.category, project.year].filter(Boolean).join(' · ') || 'Проект')}</p></div><span class="card-arrow" aria-hidden="true">↗</span></div>
</a></article>`).join('');
  const date = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(new Date(snapshot.syncedAt));
  return layout(config, { title: config.title, content: `<section class="intro"><p class="eyebrow">Портфолио / Дизайн</p><h1>Работы и идеи.</h1><p class="intro-text">${e(config.description)}</p></section>
<section id="works" aria-label="Работы"><div class="section-heading"><h2>Проекты <span class="count">${snapshot.projects.length}</span></h2><span class="muted">${e(snapshot.sourceName)}</span></div>${filters}<div class="grid">${cards}</div><p class="empty-filter" hidden>В этой категории пока нет работ.</p>${!snapshot.projects.length ? '<div class="empty-state"><h2>Здесь будут работы</h2><p>Добавь папку проекта с info.txt и изображениями на Диск, затем обнови сайт.</p></div>' : ''}</section>
<aside class="sync-note"><span class="status-dot" aria-hidden="true"></span><span>Синхронизировано ${e(date)} МСК · Папок: ${snapshot.projects.length}</span><a href="./sync-report.html">Отчёт о загрузке ↗</a></aside>` });
}

export function renderProject(config, project, next) {
  const base = '../../';
  const description = project.description.split(/\n\s*\n/).filter(Boolean).map((p) => `<p>${e(p).replaceAll('\n', '<br>')}</p>`).join('');
  const gallery = project.images.map((image, index) => `<figure><button class="image-button" data-full-image="${base}${e(image.src)}" aria-label="Увеличить: ${e(image.name)}"><img src="${base}${e(image.src)}" alt="${e(project.title)} — ${e(image.name)}" ${index ? 'loading="lazy"' : ''}></button></figure>`).join('');
  return layout(config, { title: `${project.title} — ${config.title}`, base, page: 'project', content: `<a class="back" href="${base}#works">← Все работы</a><section class="project-intro"><p class="eyebrow">${e([project.category, project.year].filter(Boolean).join(' / ') || 'Проект')}</p><h1>${e(project.title)}</h1>${description ? `<div class="description">${description}</div>` : '<p class="muted">Описание пока не добавлено.</p>'}</section><section class="gallery" aria-label="Изображения проекта">${gallery || '<div class="empty-state"><h2>Материалы скоро появятся</h2><p>Папка проекта уже подключена. Добавь изображения на Диск и запусти обновление сайта.</p></div>'}</section>${next ? `<a class="next-project" href="../${next.slug}/"><span>Следующий проект</span><strong>${e(next.title)} ↗</strong></a>` : ''}` });
}

function renderReport(config, snapshot) {
  return layout(config, { title: `Отчёт о загрузке — ${config.title}`, content: `<a class="back" href="./">← К портфолио</a><section class="report"><p class="eyebrow">Проверка подключения</p><h1>Отчёт о загрузке</h1><p>Папка: <strong>${e(snapshot.sourceName)}</strong></p><p>Последняя успешная синхронизация: <time datetime="${e(snapshot.syncedAt)}">${e(snapshot.syncedAt)}</time></p><p>Проектов: ${snapshot.projects.length} · Изображений: ${snapshot.projects.reduce((n, p) => n + p.images.length, 0)}</p>${snapshot.warnings.length ? `<h2>Что можно дополнить</h2><ul>${snapshot.warnings.map((w) => `<li>${e(w)}</li>`).join('')}</ul>` : '<p>Все проекты загружены без замечаний.</p>'}<p class="muted">Этот отчёт отражает последнюю сборку. Изменения на Диске появятся после следующего обновления сайта.</p></section>` });
}

export async function buildPortfolio(root = process.cwd(), { skipUnchanged = false } = {}) {
  const config = JSON.parse(await readFile(resolve(root, 'portfolio.config.json'), 'utf8'));
  let snapshot;
  try { snapshot = JSON.parse(await readFile(resolve(root, '.cache/portfolio.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') throw new Error('Сначала запустите npm run sync, чтобы загрузить работы с Диска.'); throw error; }
  const version = await siteVersion(root, config, snapshot);
  if (skipUnchanged) {
    try {
      const previous = JSON.parse(await readFile(resolve(root, 'dist/site-version.json'), 'utf8'));
      await readFile(resolve(root, 'dist/index.html'));
      if (previous.version === version) return { ...snapshot, changed: false, version };
    } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  }
  config.version = version;
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
      for (const image of project.images) {
        const target = resolve(stage, image.src);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(resolve(root, '.cache', image.src), target);
      }
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
