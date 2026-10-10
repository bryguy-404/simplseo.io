import { it, expect, vi, beforeEach } from 'vitest';
vi.mock('firebase/firestore', () => ({ setDoc: vi.fn(), getDoc: vi.fn() }));
vi.mock('../app/lib/authenticatedFetch', () => ({ authenticatedFetch: vi.fn() }));
import { setDoc, getDoc } from 'firebase/firestore';
import { authenticatedFetch } from '../app/lib/authenticatedFetch';
import { writeSeoRecord } from '../app/lib/writeSeoRecord';
const ref = { parent: { id: 'implementedSeoTips' } };
beforeEach(() => { vi.clearAllMocks(); authenticatedFetch.mockResolvedValue({ ok: true }); });
it('starts a fresh current record only after history has been preserved', async () => {
  getDoc.mockResolvedValue({ data: () => ({ userId: 'alice', pageUrl: 'https://example.test', preRevampArchived: true, postStats: { clicks: 99 } }) });
  await writeSeoRecord(ref, { title: 'New title', preStats: { clicks: 1 } }, { merge: true });
  expect(authenticatedFetch).toHaveBeenCalledWith('/api/revamp/prepare-write', { method: 'POST' });
  expect(setDoc).toHaveBeenCalledWith(ref, { userId: 'alice', pageUrl: 'https://example.test', title: 'New title', preStats: { clicks: 1 }, preRevampArchived: false }, undefined);
});
it('does not overwrite records when history is incomplete', async () => {
  authenticatedFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'History is being preserved' }) });
  await expect(writeSeoRecord(ref, { title: 'New' })).rejects.toThrow('History is being preserved');
  expect(setDoc).not.toHaveBeenCalled();
});
it('preserves a protected prior assessment on archived replacement, strips credentials and rejects a supplied forged assessment', async () => {
  const assessment = { schemaVersion: 1, state: 'ready', implementedAt: '2026-01-01', comparison: { clicksDelta: 5 } };
  getDoc.mockResolvedValue({ data: () => ({ userId: 'alice', pageUrl: 'https://example.test', preRevampArchived: true, progressAssessment: assessment, gscToken: 'old-secret', postStats: { clicks: 99 } }) });
  await writeSeoRecord(ref, { implementedAt: '2026-10-10', progressAssessment: { state: 'forged' }, gscToken: 'new-secret' }, { merge: true });
  expect(setDoc).toHaveBeenCalledWith(ref, { userId: 'alice', pageUrl: 'https://example.test', preRevampArchived: false, implementedAt: '2026-10-10', progressAssessment: assessment }, undefined);
});
