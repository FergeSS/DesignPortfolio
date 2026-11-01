import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as pause } from 'node:timers/promises';
import { syncPortfolio } from '../scripts/sync.mjs';
import { buildPortfolio } from '../scripts/build.mjs';
import { AdminError } from './disk.mjs';

const exec = promisify(execFile);
export class Publication {
  constructor({ root, service, run = (args) => exec('gh', args, { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 }), refresh = async () => { await syncPortfolio({ root }); await buildPortfolio(root); }, sleep = pause }) {
    Object.assign(this, { service, run, refresh, sleep });
    this.state = { active: false, status: 'idle', message: 'Публикация ещё не запускалась.' };
  }
  start() {
    if (this.state.active) throw new AdminError('Обновление сайта уже запущено.', 409);
    this.state = { active: true, status: 'checking', message: 'Проверяю каталог и подключение к GitHub…', startedAt: new Date().toISOString() };
    this.pending = this.work().catch((error) => {
      this.state = { ...this.state, active: false, status: 'error', message: error instanceof AdminError ? error.message : 'Публикация не выполнена. Проверь подключение к Диску и авторизацию GitHub через gh auth login.' };
    });
    return this.state;
  }
  async runs() {
    const { stdout } = await this.run(['run', 'list', '--workflow', 'pages.yml', '--branch', 'main', '--event', 'workflow_dispatch', '--limit', '10', '--json', 'databaseId,status,conclusion,url,createdAt']);
    return JSON.parse(stdout);
  }
  async work() {
    let before;
    await this.service.exclusive(async () => {
      if (this.service.writer) {
        await this.service.writable();
        const projects = await this.service.projects();
        if (projects.some((project) => project.problem)) throw new AdminError('Исправь предупреждения в описаниях работ перед публикацией.');
      }
      try { before = new Set((await this.runs()).map((run) => run.databaseId)); }
      catch { throw new AdminError('Нет доступа к GitHub. Выполни gh auth login в терминале и повтори публикацию.', 502); }
      this.state = { ...this.state, status: 'building', message: 'Читаю актуальные данные с Диска и проверяю сборку…' };
      await this.refresh();
      await this.run(['workflow', 'run', 'pages.yml', '--ref', 'main']);
    });
    this.state = { ...this.state, status: 'queued', message: 'Обновление отправлено в GitHub. Ожидаю сборку сайта…' };
    let id;
    for (let attempt = 0; attempt < 100; attempt++) {
      await this.sleep(6000);
      let runs;
      try { runs = await this.runs(); } catch { continue; }
      const run = id ? runs.find((item) => item.databaseId === id) : runs.find((item) => !before.has(item.databaseId) && Date.parse(item.createdAt) >= Date.parse(this.state.startedAt) - 5000);
      if (!run) continue;
      id = run.databaseId;
      const url = /^https:\/\/github\.com\//.test(run.url) ? run.url : undefined;
      if (run.status === 'completed') {
        this.state = { ...this.state, active: false, status: run.conclusion === 'success' ? 'success' : 'error', url, message: run.conclusion === 'success' ? 'Сайт обновлён. Открытая страница подхватит изменения примерно в течение минуты.' : 'GitHub не опубликовал обновление. Открой журнал запуска для подробностей.' };
        return;
      }
      this.state = { ...this.state, status: run.status, url, message: run.status === 'queued' ? 'Обновление в очереди GitHub…' : 'GitHub собирает и публикует сайт…' };
    }
    this.state = { ...this.state, active: false, status: 'waiting', message: 'Публикация занимает больше обычного. Проверь её завершение в GitHub Actions.' };
  }
}
