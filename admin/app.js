const $ = (selector) => document.querySelector(selector);
const state = { key: '', connected: false, projects: [], current: null, dirty: false, busy: false, publication: { active: false }, replaceName: '', maxUpload: 128 * 1024 * 1024 };
let toastTimer, publicationTimer;
const form = $('#metadata-form');
function toast(message, error = false) { clearTimeout(toastTimer); const node = $('#toast'); node.textContent = message; node.className = error ? 'toast error' : 'toast'; node.hidden = false; toastTimer = setTimeout(() => { node.hidden = true; }, error ? 11000 : 5000); }
async function api(path, { method = 'GET', data, bytes } = {}) {
  const headers = {};
  if (method !== 'GET') headers['X-Admin-Key'] = state.key;
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { method, headers, body: bytes || (data === undefined ? undefined : JSON.stringify(data)), cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Не удалось выполнить запрос.');
  return result;
}
function locks() {
  const locked = !state.connected || state.busy || state.publication.active;
  $('#new-project').disabled = locked;
  $('#save').disabled = locked || !state.current || !state.dirty;
  $('#delete-project').disabled = locked || !state.current;
  $('#publish').disabled = state.busy || state.publication.active;
  $('#refresh').disabled = state.busy;
  for (const field of form.elements) { if (field.type === 'checkbox') field.disabled = locked; else field.readOnly = locked; }
  document.querySelectorAll('[data-write]').forEach((button) => { button.disabled = locked; });
  $('#dropzone').classList.toggle('disabled', locked); $('#dropzone').setAttribute('aria-disabled', String(locked));
  $('#save-status').textContent = !state.connected ? 'Подключи Диск, чтобы редактировать работу.' : state.dirty ? 'Есть несохранённые изменения.' : 'Изменения сохранены на Диске. Для публикации нажми «Обновить сайт».';
}
async function perform(task) {
  if (state.busy) return;
  state.busy = true; locks();
  try { return await task(); }
  catch (error) { toast(error.message || 'Нет соединения с админкой. Проверь, что она запущена.', true); }
  finally { state.busy = false; locks(); }
}
function connection(status) {
  state.connected = status.connected; state.maxUpload = status.maxUpload || state.maxUpload;
  $('#connection').textContent = status.connected ? '● Диск подключён' : '○ Только просмотр';
  $('#connection').classList.toggle('connected', status.connected); $('#readonly').hidden = status.connected;
  $('#settings-root').value = status.root;
  $('#token-hint').textContent = status.connected ? 'Токен уже сохранён локально. Оставь поле пустым, чтобы использовать его снова.' : 'Нужны разрешения на чтение и запись Диска.';
  locks();
}
function renderList() {
  const list = $('#project-list'); list.replaceChildren();
  const query = $('#search').value.toLowerCase().trim();
  const projects = state.projects.filter((project) => `${project.title} ${project.folder} ${project.category}`.toLowerCase().includes(query));
  $('#project-count').textContent = state.projects.length;
  for (const project of projects) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'project-item' + (state.current?.folder === project.folder ? ' active' : '');
    const cover = project.images.find((image) => image.name === project.cover);
    if (cover) { const image = document.createElement('img'); image.src = cover.thumbnail; image.alt = ''; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; button.append(image); }
    const copy = document.createElement('span'), title = document.createElement('strong'), meta = document.createElement('small');
    title.textContent = project.title; meta.textContent = `${project.published ? 'На сайте' : 'Скрыто'} · ${project.images.length} изобр.${project.problem ? ' · ⚠' : ''}`;
    copy.append(title, meta); button.append(copy); button.addEventListener('click', () => {
      if (state.busy || (state.dirty && !confirm('Есть несохранённые изменения. Перейти к другой работе без сохранения?'))) return;
      setProject(project);
    }); list.append(button);
  }
  if (!projects.length) { const empty = document.createElement('p'); empty.className = 'muted loading'; empty.textContent = query ? 'Ничего не найдено.' : 'Работ пока нет. Добавь первую.'; list.append(empty); }
}
function metadata() {
  const values = {};
  for (const name of ['title', 'category', 'year', 'order', 'slug', 'description']) values[name] = form.elements.namedItem(name).value;
  values.published = form.elements.namedItem('published').checked;
  return values;
}
function setProject(project) {
  state.current = project; state.dirty = false;
  $('#editor-empty').hidden = Boolean(project); $('#editor-body').hidden = !project;
  $('#editor-title').textContent = project?.title || 'Выбери работу';
  $('#folder-path').textContent = project ? `Папка: ${project.folder}` : '';
  $('#project-warning').hidden = !project?.problem; $('#project-warning').textContent = project?.problem || '';
  if (project) {
    for (const name of ['title', 'category', 'year', 'order', 'slug', 'description']) form.elements.namedItem(name).value = project[name] ?? '';
    form.elements.namedItem('published').checked = project.published;
    renderImages();
  }
  renderList(); locks();
}
function updateProject(project) {
  const index = state.projects.findIndex((item) => item.folder === project.folder);
  if (index >= 0) state.projects[index] = project; else state.projects.push(project);
  state.projects.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'ru', { numeric: true }));
  setProject(project);
}
async function loadProjects(folder = state.current?.folder) {
  const data = await api('/api/projects'); state.projects = data.projects;
  setProject(state.projects.find((item) => item.folder === folder) || state.projects[0] || null);
}
async function saveCurrent() {
  if (!state.current || !state.dirty) return;
  if (!form.reportValidity()) throw new Error('Проверь поля работы.');
  const project = await api('/api/project', { method: 'PUT', data: { folder: state.current.folder, version: state.current.version, metadata: metadata() } });
  updateProject(project);
}
function bytesLabel(bytes) { return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} МБ` : `${Math.round(bytes / 1024)} КБ`; }
function action(label, callback, danger = false) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.write = ''; if (danger) button.className = 'danger'; button.addEventListener('click', callback); return button;
}
function renderImages() {
  const list = $('#image-list'); list.replaceChildren(); $('#image-count').textContent = state.current.images.length;
  for (const image of state.current.images) {
    const card = document.createElement('article'); card.className = 'image-card';
    const preview = document.createElement('div'); preview.className = 'image-preview';
    const img = document.createElement('img'); img.src = image.thumbnail; img.loading = 'lazy'; img.alt = image.name; img.referrerPolicy = 'no-referrer'; preview.append(img);
    const isCover = image.name === state.current.cover;
    if (isCover) { const badge = document.createElement('span'); badge.className = 'cover-badge'; badge.textContent = 'Обложка'; preview.append(badge); }
    const details = document.createElement('div'); details.className = 'image-details';
    const name = document.createElement('p'); name.className = 'image-name'; name.textContent = image.name;
    const size = document.createElement('p'); size.className = 'image-size'; size.textContent = bytesLabel(image.size);
    const actions = document.createElement('div'); actions.className = 'image-actions';
    if (!isCover) actions.append(action('Сделать обложкой', () => perform(async () => { await saveCurrent(); updateProject(await api('/api/cover', { method: 'POST', data: { folder: state.current.folder, name: image.name, version: state.current.version } })); toast('Обложка изменена.'); })));
    actions.append(action('Заменить', () => { state.replaceName = image.name; $('#replace-input').accept = '.' + image.name.split('.').at(-1); $('#replace-input').click(); }));
    actions.append(action('В корзину', () => { if (!confirm(`Переместить «${image.name}» в корзину Яндекс Диска?`)) return; perform(async () => { await saveCurrent(); updateProject(await api('/api/file', { method: 'DELETE', data: { folder: state.current.folder, name: image.name, version: state.current.version } })); toast('Изображение перемещено в корзину.'); }); }, true));
    details.append(name, size, actions); card.append(preview, details); list.append(card);
  }
  if (!state.current.images.length) { const empty = document.createElement('p'); empty.className = 'empty small'; empty.textContent = 'Загрузи изображения. Одно из них можно сделать обложкой.'; list.append(empty); }
}
async function upload(files, replaceName = '') {
  if (!state.connected || !files.length || !state.current) return;
  await perform(async () => {
    await saveCurrent();
    $('#upload-progress').hidden = false;
    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index]; if (file.size > state.maxUpload) throw new Error(`«${file.name}» больше 128 МБ.`);
        $('#upload-progress').textContent = `Загрузка ${index + 1} из ${files.length}: ${file.name}…`;
        const params = new URLSearchParams({ folder: state.current.folder, name: replaceName || file.name, version: state.current.version, replace: replaceName ? '1' : '0' });
        updateProject(await api('/api/upload?' + params, { method: 'POST', bytes: file }));
      }
      toast(replaceName ? 'Изображение заменено.' : 'Изображения загружены на Диск.');
    } finally { $('#upload-progress').hidden = true; $('#upload-input').value = ''; $('#replace-input').value = ''; }
  });
}
function publication(result) {
  state.publication = result;
  const box = $('#publication'); box.hidden = result.status === 'idle'; box.className = 'publication' + (result.status === 'success' ? ' success' : result.status === 'error' ? ' error' : '');
  $('#publication-text').textContent = result.message;
  const link = $('#publication-link'); link.hidden = !result.url; if (result.url) link.href = result.url;
  locks(); clearTimeout(publicationTimer);
  if (result.active) publicationTimer = setTimeout(async () => { try { publication(await api('/api/publication')); } catch { publicationTimer = setTimeout(pollPublication, 5000); } }, 4000);
}
async function pollPublication() { try { publication(await api('/api/publication')); } catch { publicationTimer = setTimeout(pollPublication, 5000); } }
form.addEventListener('input', () => { state.dirty = true; locks(); });
form.addEventListener('submit', (event) => { event.preventDefault(); perform(async () => { await saveCurrent(); toast('Описание сохранено на Диске.'); }); });
$('#save').addEventListener('click', () => perform(async () => { await saveCurrent(); toast('Описание сохранено на Диске.'); }));
$('#publish').addEventListener('click', () => perform(async () => { await saveCurrent(); publication(await api('/api/publish', { method: 'POST' })); }));
$('#search').addEventListener('input', renderList);
$('#refresh').addEventListener('click', () => { if (state.dirty && !confirm('Обновить данные и отменить несохранённые правки?')) return; perform(() => loadProjects()); });
$('#settings-open').addEventListener('click', () => { $('#settings-error').hidden = true; $('#settings-dialog').showModal(); });
$('#connect-shortcut').addEventListener('click', () => $('#settings-open').click());
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
$('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (state.busy) return;
  state.busy = true; locks(); $('#settings-submit').disabled = true; $('#settings-submit').textContent = 'Проверяю доступ…'; $('#settings-error').hidden = true;
  try { const result = await api('/api/settings', { method: 'POST', data: { root: $('#settings-root').value, token: $('#settings-token').value } }); connection(result); $('#settings-token').value = ''; $('#settings-dialog').close(); await loadProjects(); toast('Диск подключён. Можно редактировать работы.'); }
  catch (error) { $('#settings-error').textContent = error.message; $('#settings-error').hidden = false; }
  finally { state.busy = false; locks(); $('#settings-submit').disabled = false; $('#settings-submit').textContent = 'Проверить и подключить'; }
});
let folderEdited = false;
$('#new-project').addEventListener('click', () => { $('#new-form').reset(); $('#new-error').hidden = true; folderEdited = false; $('#new-dialog').showModal(); $('#new-title').focus(); });
$('#new-folder').addEventListener('input', () => { folderEdited = true; });
$('#new-title').addEventListener('input', () => { if (!folderEdited) $('#new-folder').value = $('#new-title').value.replace(/[\\/:*?"<>|]/g, '-').trim(); });
$('#new-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (state.busy) return;
  state.busy = true; locks(); $('#new-submit').disabled = true; $('#new-error').hidden = true;
  try { await saveCurrent(); const project = await api('/api/projects', { method: 'POST', data: { folder: $('#new-folder').value.trim(), metadata: { title: $('#new-title').value.trim(), category: '', year: '', order: 9999, slug: '', description: '', published: false } } }); updateProject(project); $('#new-dialog').close(); toast('Работа создана скрытой. Теперь добавь изображения.'); }
  catch (error) { $('#new-error').textContent = error.message; $('#new-error').hidden = false; }
  finally { state.busy = false; locks(); $('#new-submit').disabled = false; }
});
$('#delete-project').addEventListener('click', () => { if (!state.current || !confirm(`Переместить работу «${state.current.title}» целиком в корзину Яндекс Диска?`)) return; perform(async () => { await api('/api/project', { method: 'DELETE', data: { folder: state.current.folder, version: state.current.version } }); state.projects = state.projects.filter((project) => project.folder !== state.current.folder); setProject(state.projects[0] || null); toast('Работа перемещена в корзину. Обнови сайт, чтобы убрать её из портфолио.'); }); });
const dropzone = $('#dropzone');
dropzone.addEventListener('click', () => { if (dropzone.getAttribute('aria-disabled') !== 'true') $('#upload-input').click(); });
dropzone.addEventListener('keydown', (event) => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); dropzone.click(); } });
dropzone.addEventListener('dragover', (event) => { event.preventDefault(); if (dropzone.getAttribute('aria-disabled') !== 'true') dropzone.classList.add('dragging'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
dropzone.addEventListener('drop', (event) => { event.preventDefault(); dropzone.classList.remove('dragging'); if (dropzone.getAttribute('aria-disabled') !== 'true') upload([...event.dataTransfer.files]); });
$('#upload-input').addEventListener('change', () => upload([...$('#upload-input').files]));
$('#replace-input').addEventListener('change', () => upload([...$('#replace-input').files], state.replaceName));
window.addEventListener('beforeunload', (event) => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
async function init() {
  await perform(async () => { const session = await api('/api/session'); state.key = session.key; connection(session); publication(session.publication); await loadProjects(); });
}
init();
