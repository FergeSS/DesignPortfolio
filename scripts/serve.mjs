import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createAutoRefresh } from './auto-refresh.mjs';

const root = resolve('dist');
const auto = !process.argv.includes('--static');
const updater = createAutoRefresh({
  onUpdate: (result) => console.log(result.changed ? `Сайт обновлён. Проектов: ${result.projects.length}.` : 'Проверка Диска: материалы не изменились.'),
  onError: (error) => console.error(`Не удалось обновить сайт: ${error.message}\nСохраняем предыдущую версию. Следующая автоматическая попытка через сутки.`),
});
if (auto) {
  console.log('Проверяю материалы на Яндекс Диске…');
  await updater.run();
}
try { await stat(resolve(root, 'index.html')); }
catch { console.error('Нет готового сайта. Проверьте интернет и доступ к Диску, затем повторите npm run dev.'); process.exit(1); }
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' };
const server = createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const url = new URL(req.url, 'http://localhost');
    const file = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const details = await stat(file);
    if (details.isDirectory() && !url.pathname.endsWith('/')) { res.writeHead(301, { Location: url.pathname + '/' + url.search }); res.end(); return; }
    const target = details.isDirectory() ? resolve(file, 'index.html') : file;
    const bytes = await readFile(target);
    res.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Length': bytes.length });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (error) {
    res.writeHead(error instanceof URIError ? 400 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Страница не найдена');
  }
});
server.on('error', (error) => {
  updater.stop();
  console.error(error.code === 'EADDRINUSE' ? 'Порт уже занят. Укажите другой через PORT=4174 npm run dev.' : `Не удалось запустить сервер: ${error.message}`);
  process.exitCode = 1;
});
server.on('close', () => updater.stop());
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => {
  console.log(`Local: http://127.0.0.1:${server.address().port}`);
  if (auto) { updater.start(); console.log('Автоматическая проверка Диска: каждые 24 часа, пока сервер работает.'); }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  updater.stop();
  server.close();
});
