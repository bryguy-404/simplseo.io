import { expect, test } from 'vitest';
import { invitationEmailHtml, longDate, requestEmailHtml } from '../app/lib/server/accessEmailTemplate';

const origin = 'https://simpl-seo.com';

test('the invitation carries its link, a readable expiry date and the sign-in link', () => {
  const html = invitationEmailHtml({ origin, href: `${origin}/accept-invite#token=abc.def`, name: 'Alex', expiresAt: '2026-12-09T15:00:00.000Z' });
  expect(html).toContain('href="https://simpl-seo.com/accept-invite#token=abc.def"');
  expect(html).toContain('Hi Alex,');
  expect(html).toContain('expires on December 9, 2026');
  expect(html).toContain('href="https://simpl-seo.com/auth"');
  expect(html).toContain('There is no code to enter.');
});

test('the invitation still reads properly without a name', () => {
  const html = invitationEmailHtml({ origin, href: `${origin}/accept-invite#token=abc.def`, name: '', expiresAt: '2026-12-09T15:00:00.000Z' });
  expect(html).toContain('Hi, your spot');
});

test('whatever a requester typed is shown as text, never as HTML', () => {
  const nasty = '<script>alert(1)</script>';
  const html = requestEmailHtml({ origin, href: `${origin}/admin/access-requests`, email: 'a@b.co', name: nasty, company: `"${nasty}`, reason: nasty });
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).toContain('href="https://simpl-seo.com/admin/access-requests"');
  const invitation = invitationEmailHtml({ origin, href: `${origin}/accept-invite#token=x`, name: nasty, expiresAt: '2026-12-09T15:00:00.000Z' });
  expect(invitation).not.toContain('<script>');
});

test('missing request details say so instead of leaving a blank', () => {
  const html = requestEmailHtml({ origin, href: `${origin}/admin/access-requests`, email: 'a@b.co' });
  expect(html.match(/Not provided/g)).toHaveLength(3);
});

test('an unreadable date falls back to what was given', () => {
  expect(longDate('2026-12-09T15:00:00.000Z')).toBe('December 9, 2026');
  expect(longDate('not a date')).toBe('not a date');
});
