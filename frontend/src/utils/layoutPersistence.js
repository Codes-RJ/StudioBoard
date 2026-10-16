let fallbackId = 0;

export const createClientLayoutId = () => {
  if (globalThis.crypto?.randomUUID) return `local_${globalThis.crypto.randomUUID()}`;
  fallbackId += 1;
  return `local_${Date.now()}_${fallbackId}`;
};

export const createSerialTaskQueue = () => {
  let tail = Promise.resolve();

  return (task) => {
    if (typeof task !== 'function') {
      return Promise.reject(new TypeError('Queued work must be a function.'));
    }

    const result = tail.then(task, task);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
};

export const resolveServerLayoutId = (layoutId, persistedIds, aliases) => {
  if (!layoutId) return null;
  if (aliases?.has(layoutId)) return aliases.get(layoutId);
  return persistedIds?.has(layoutId) ? layoutId : null;
};
