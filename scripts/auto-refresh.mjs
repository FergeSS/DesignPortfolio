import { syncPortfolio } from './sync.mjs';
import { buildPortfolio } from './build.mjs';

export const DAY_MS = 24 * 60 * 60 * 1000;

// Use a single queue: overlapping requests share a refresh, failures keep the
// previous site and do not prevent the next scheduled attempt.
export function createAutoRefresh({
  root = process.cwd(),
  refresh = async () => {
    await syncPortfolio({ root });
    return buildPortfolio(root, { skipUnchanged: true });
  },
  onUpdate = () => {},
  onError = () => {},
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  let pending;
  let timer;
  let running = false;

  function run() {
    if (pending) return pending;
    pending = Promise.resolve().then(refresh).then((result) => {
      onUpdate(result);
      return result;
    }).catch((error) => {
      onError(error);
      return { error };
    }).finally(() => { pending = undefined; });
    return pending;
  }

  function queue() {
    timer = schedule(async () => {
      timer = undefined;
      await run();
      if (running) queue();
    }, DAY_MS);
  }

  return {
    run,
    start() { if (!running) { running = true; queue(); } },
    stop() { running = false; if (timer !== undefined) cancel(timer); timer = undefined; },
  };
}
