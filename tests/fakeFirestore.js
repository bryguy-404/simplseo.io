// Small transactional test double for request/service tests. Browser tests use real emulators.
export function fakeFirestore() {
  const records = new Map();
  const clone = value => value === undefined ? undefined : structuredClone(value);
  const doc = path => ({
    path, id: path.split('/').at(-1),
    collection: name => collection(`${path}/${name}`),
    get: async () => ({ id: path.split('/').at(-1), exists: records.has(path), ref: doc(path), data: () => clone(records.get(path)) }),
    set: async (value, options) => { records.set(path, options?.merge ? { ...records.get(path), ...clone(value) } : clone(value)); },
    update: async value => { if (!records.has(path)) throw Error('missing'); records.set(path, { ...records.get(path), ...clone(value) }); },
    delete: async () => records.delete(path),
  });
  const collection = (path, filters = [], maximum = Infinity, ordering = null) => ({
    doc: id => doc(`${path}/${id}`),
    where: (field, op, value) => collection(path, [...filters, [field, value]], maximum, ordering),
    limit: count => collection(path, filters, count, ordering),
    orderBy: (field, direction = 'asc') => collection(path, filters, maximum, [field, direction]),
    get: async () => {
      const docs = [];
      for (const [key, value] of records) if (key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1 && filters.every(([k, v]) => value[k] === v)) docs.push(await doc(key).get());
      if (ordering) { const [field, direction] = ordering; docs.sort((a, b) => String(a.data()[field] || '').localeCompare(String(b.data()[field] || '')) * (direction === 'desc' ? -1 : 1)); }
      const selected = docs.slice(0, maximum);
      return { docs: selected, size: selected.length, empty: selected.length === 0 };
    },
  });
  const batch = () => { const writes = []; return { set: (...args) => writes.push(() => args[0].set(...args.slice(1))), update: (...args) => writes.push(() => args[0].update(...args.slice(1))), commit: async () => { for (const write of writes) await write(); } }; };
  const db = { collection, batch, runTransaction: async fn => {
    const writes = [];
    const result = await fn({ get: ref => ref.get(), set: (ref, ...args) => writes.push(() => ref.set(...args)), update: (ref, value) => writes.push(() => ref.update(value)), create: (ref, value) => writes.push(() => ref.set(value)), delete: ref => writes.push(() => ref.delete()) });
    for (const write of writes) await write(); return result;
  } };
  return { db, records, reset: () => records.clear() };
}
