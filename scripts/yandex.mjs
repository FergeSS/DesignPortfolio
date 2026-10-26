const API = 'https://cloud-api.yandex.net/v1/disk/public/resources';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function requestBytes(url, { maxBytes = 2 * 1024 * 1024, fetchImpl = fetch } = {}) {
  if (new URL(url).protocol !== 'https:') throw new Error('Ожидалась HTTPS-ссылка.');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) {
        await response.body?.cancel();
        const error = new Error(`Яндекс Диск: HTTP ${response.status}. Проверьте доступ по ссылке и возможность скачивания.`);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      if (Number(response.headers.get('content-length')) > maxBytes) {
        await response.body?.cancel();
        throw Object.assign(new Error('Файл превышает допустимый размер.'), { retryable: false });
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > maxBytes) throw Object.assign(new Error('Файл превышает допустимый размер.'), { retryable: false });
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      if (error.retryable === false || attempt === 2) throw error;
      await pause(1000 * (attempt + 1));
    }
  }
}

export class YandexDisk {
  constructor(publicUrl, fetchImpl = fetch) {
    this.publicUrl = publicUrl;
    this.fetchImpl = fetchImpl;
  }

  async api(endpoint = '', params = {}) {
    const url = new URL(API + endpoint);
    url.searchParams.set('public_key', this.publicUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return JSON.parse((await requestBytes(url, { fetchImpl: this.fetchImpl })).toString('utf8'));
  }

  async list(path) {
    const items = [];
    let name;
    let offset = 0;
    while (true) {
      const page = await this.api('', { path, limit: 100, offset });
      if (page.type !== 'dir' || !page._embedded) throw new Error(`${path}: ссылка должна вести на папку.`);
      name = page.name;
      const batch = page._embedded.items;
      items.push(...batch);
      offset += batch.length;
      if (offset >= page._embedded.total) break;
      if (!batch.length) throw new Error(`${path}: Диск вернул неполный список файлов.`);
    }
    return { name, items };
  }

  async download(path, maxBytes) {
    const { href } = await this.api('/download', { path });
    if (!href) throw new Error(`${path}: Диск не выдал ссылку на скачивание.`);
    return requestBytes(href, { maxBytes, fetchImpl: this.fetchImpl });
  }
}
