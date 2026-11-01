import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { AdminService } from '../admin/service.mjs';
import { AdminError } from '../admin/disk.mjs';
import { Publication } from '../admin/publication.mjs';

export const MAX_UPLOAD = 128 * 1024 * 1024;
async function body(req, limit) {
  if (Number(req.headers['content-length']) > limit) throw new AdminError('Файл слишком большой. Максимум 128 МБ.', 413);
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new AdminError('Запрос слишком большой.', 413); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function jsonBody(req) {
  try { return JSON.parse((await body(req, 1024 * 1024)).toString('utf8')); }
  catch (error) { if (error instanceof AdminError) throw error; throw new AdminError('Некорректный запрос.'); }
}
export async function createAdminServer({ root, service, publication, port = 4317 } = {}) {
  root ||= resolve(dirname(fileURLToPath(import.meta.url)), '..');
  if (!service) {
    const config = JSON.parse(await readFile(resolve(root, 'portfolio.config.json'), 'utf8'));
    config.publicUrl = process.env.YANDEX_DISK_PUBLIC_URL || config.publicUrl;
    service = await new AdminService({ root, config }).init();
  }
  publication ||= new Publication({ root, service });
  const key = randomBytes(32).toString('hex');
  const directory = resolve(root, 'admin');
  const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
  const server = createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    function json(data, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
    try {
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') throw new AdminError('Доступ разрешён только с локальной страницы админки.', 403);
      if (!['GET', 'HEAD'].includes(req.method)) {
        const supplied = Buffer.from(String(req.headers['x-admin-key'] || ''));
        if (req.headers.origin !== origin || supplied.length !== key.length || !timingSafeEqual(supplied, Buffer.from(key))) throw new AdminError('Обнови страницу админки и повтори действие.', 403);
      }
      const url = new URL(req.url, origin), path = url.pathname;
      if (req.method === 'GET' && path === '/api/session') return json({ key, ...service.status(), maxUpload: MAX_UPLOAD, publication: publication.state });
      if (req.method === 'GET' && path === '/api/projects') return json({ projects: await service.projects() });
      if (req.method === 'GET' && path === '/api/project') return json(await service.project(url.searchParams.get('folder')));
      if (req.method === 'GET' && path === '/api/publication') return json(publication.state);
      if (req.method === 'GET' && path === '/api/thumbnail') {
        const href = await service.thumbnail(url.searchParams.get('folder'), url.searchParams.get('name'), url.searchParams.get('revision'));
        res.writeHead(302, { Location: href }); res.end(); return;
      }
      if (req.method === 'POST' && path === '/api/settings') { const data = await jsonBody(req); return json(await service.exclusive(() => service.connect(data))); }
      if (req.method === 'POST' && path === '/api/projects') { const data = await jsonBody(req); return json(await service.exclusive(() => service.create(data)), 201); }
      if (req.method === 'PUT' && path === '/api/project') { const data = await jsonBody(req); return json(await service.exclusive(() => service.save(data))); }
      if (req.method === 'DELETE' && path === '/api/project') { const data = await jsonBody(req); return json(await service.exclusive(() => service.removeProject(data))); }
      if (req.method === 'DELETE' && path === '/api/file') { const data = await jsonBody(req); return json(await service.exclusive(() => service.removeFile(data))); }
      if (req.method === 'POST' && path === '/api/cover') { const data = await jsonBody(req); return json(await service.exclusive(() => service.cover(data))); }
      if (req.method === 'POST' && path === '/api/upload') {
        const data = { folder: url.searchParams.get('folder'), name: url.searchParams.get('name'), version: url.searchParams.get('version'), replace: url.searchParams.get('replace') === '1', bytes: await body(req, MAX_UPLOAD) };
        return json(await service.exclusive(() => service.upload(data)));
      }
      if (req.method === 'POST' && path === '/api/publish') { await body(req, 100); return json(publication.start(), 202); }
      if (['GET', 'HEAD'].includes(req.method) && (assets[path] || path === '/jost.ttf' || path === '/favicon.ico')) {
        if (path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
        const [name, type] = assets[path] || ['../src/fonts/jost-regular.ttf', 'font/ttf'];
        const bytes = await readFile(resolve(directory, name));
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length }); res.end(req.method === 'HEAD' ? undefined : bytes); return;
      }
      throw new AdminError('Страница не найдена.', 404);
    } catch (error) {
      if (!res.headersSent) json({ error: error instanceof AdminError ? error.message : 'Не удалось выполнить операцию. Проверь подключение и обнови данные.' }, error instanceof AdminError ? error.status : 500);
      else res.end();
    }
  });
  server.requestTimeout = 240000;
  server.headersTimeout = 15000;
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolveListen); });
  return { server, service, publication, url: `http://127.0.0.1:${server.address().port}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const app = await createAdminServer({ port: Number(process.env.ADMIN_PORT || 4317) });
    console.log(`Админка: ${app.url}\nОстановить: Ctrl+C. Настройки доступа хранятся только в .cache/admin/.`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.server.close(); app.server.closeIdleConnections(); });
  } catch (error) { console.error(error.code === 'EADDRINUSE' ? 'Админка уже запущена: http://127.0.0.1:4317' : error instanceof AdminError ? error.message : 'Не удалось запустить локальную админку.'); process.exitCode = 1; }
}
