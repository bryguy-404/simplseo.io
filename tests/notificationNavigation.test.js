import { describe, it, expect } from 'vitest';
import { notificationAuthPath, notificationReturnFromLocation, safeNotificationDestination, safeNotificationReturn } from '../app/lib/notificationNavigation';

describe('notification navigation', () => {
  it('retains an opaque notification destination through normal sign in and setup', () => {
    const destination = '/notifications/saved_abc-123';
    expect(notificationAuthPath('/auth', destination)).toBe('/auth?returnTo=%2Fnotifications%2Fsaved_abc-123');
    expect(notificationReturnFromLocation({ pathname: '/auth', search: '?returnTo=%2Fnotifications%2Fsaved_abc-123' })).toBe(destination);
    expect(notificationReturnFromLocation({ pathname: destination })).toBe(destination);
    expect(notificationAuthPath('/onboarding', destination)).toContain('returnTo=');
  });
  it.each(['https://attacker.test', '//attacker.test', '/\\attacker.test', '/notifications/../auth', '/notifications/id?returnTo=https://attacker.test', '/notifications/%2f%2fattacker', '/notifications/unsubscribe', '/api/delete-account', '/notifications/id\n'])('rejects unsafe or unrelated return %s', value => {
    expect(safeNotificationReturn(value)).toBeNull();
    expect(notificationAuthPath('/auth', value)).toBe('/auth');
  });
  it('permits only saved-work screens as destinations', () => {
    expect(safeNotificationDestination('/low-ctr?page=https%3A%2F%2Fexample.test%2F&cycleId=cycle')).toBe('/low-ctr?page=https%3A%2F%2Fexample.test%2F&cycleId=cycle');
    expect(safeNotificationDestination('/generic-keywords?planId=plan')).toBe('/generic-keywords?planId=plan');
    expect(safeNotificationDestination('/settings?tab=integrations')).toBe('/settings?tab=integrations');
    for (const value of ['//attacker.test', 'javascript:alert(1)', '/api/secret', '/auth', '/\\attacker.test', '/low-ctr\n']) expect(safeNotificationDestination(value)).toBeNull();
  });
});
