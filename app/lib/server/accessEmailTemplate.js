// The look of the two early-access emails: the invitation a new member
// receives, and the notice the administrator gets when someone asks to join.
//
// Email programs ignore most modern CSS, so this is built the way email has to
// be: tables for layout and every style written on the element itself. Nothing
// here loads an image, so it looks the same when images are blocked. The green
// dot with eyes is drawn with plain shapes.
//
// This file only builds HTML. It reads no settings and touches no data, so it
// can be previewed and tested on its own.

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const INK = '#12241b', MUTED = '#5b6b63', GREEN = '#087d44', DOT = '#00bf63', LINE = '#e3ebe6';

/** "2026-12-09T…" becomes "December 9, 2026". */
export function longDate(iso) {
  const date = new Date(iso);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : String(iso || '').slice(0, 10);
}

// The mascot: the logo's green dot, with eyes. Spacer rows place the eyes so no
// email program has to understand positioning.
function dot(size) {
  const eyeWidth = Math.round(size * 0.14), eyeHeight = Math.round(size * 0.2), gap = Math.round(size * 0.19), top = Math.round(size * 0.33);
  const eye = `<span style="display:inline-block;width:${eyeWidth}px;height:${eyeHeight}px;border-radius:${eyeWidth}px;background:#06281a;font-size:0;line-height:0">&nbsp;</span>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto"><tr><td width="${size}" align="center" valign="top" bgcolor="${DOT}" style="width:${size}px;height:${size}px;border-radius:${size}px;background:${DOT};font-size:0;line-height:0">`
    + `<div style="height:${top}px;line-height:${top}px;font-size:0">&nbsp;</div>`
    + `<div style="height:${eyeHeight}px;line-height:${eyeHeight}px;font-size:0">${eye}<span style="display:inline-block;width:${gap}px;font-size:0;line-height:0">&nbsp;</span>${eye}</div>`
    + `<div style="height:${size - top - eyeHeight}px;line-height:${size - top - eyeHeight}px;font-size:0">&nbsp;</div>`
    + '</td></tr></table>';
}

function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto"><tr><td align="center" bgcolor="${GREEN}" style="border-radius:999px;background:${GREEN}">`
    + `<a href="${escape(href)}" style="display:inline-block;padding:15px 34px;font-family:${FONT};font-size:16px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;border-radius:999px">${escape(label)}</a>`
    + '</td></tr></table>';
}

function step(number, title, detail) {
  return `<tr><td valign="top" width="44" style="width:44px;padding:0 0 18px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="30" height="30" align="center" valign="middle" bgcolor="#e6f7ee" style="width:30px;height:30px;border-radius:30px;background:#e6f7ee;font-family:${FONT};font-size:14px;font-weight:700;color:${GREEN}">${number}</td></tr></table></td>`
    + `<td valign="top" style="padding:0 0 18px;font-family:${FONT}"><p style="margin:3px 0 0;font-size:15px;font-weight:700;line-height:1.4;color:${INK}">${escape(title)}</p><p style="margin:3px 0 0;font-size:14px;line-height:1.55;color:${MUTED}">${escape(detail)}</p></td></tr>`;
}

function detail(label, value) {
  return `<tr><td valign="top" width="92" style="width:92px;padding:11px 0;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED}">${escape(label)}</td>`
    + `<td valign="top" style="padding:10px 0;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:15px;line-height:1.5;color:${INK};word-break:break-word;white-space:pre-wrap">${escape(value)}</td></tr>`;
}

// The frame both emails share: wordmark, a card with a soft green top, footer.
function shell({ preview, title, top, body, footer }) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">'
    + `<title>${escape(title)}</title></head><body style="margin:0;padding:0;background:#f2f6f3;color:${INK}">`
    // Shown beside the subject in the inbox list, hidden in the email itself.
    + `<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#f2f6f3">${escape(preview)}</div>`
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f2f6f3" style="background:#f2f6f3"><tr><td align="center" style="padding:32px 12px 40px">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">'
    + `<tr><td align="center" style="padding:0 0 20px;font-family:${FONT};font-size:24px;font-weight:800;letter-spacing:-0.02em;color:${INK}">Simpl<span style="color:${GREEN}">SEO</span></td></tr>`
    + `<tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid ${LINE};border-radius:20px">`
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
    + `<tr><td align="center" bgcolor="#eaf8f0" style="background:#eaf8f0;border-radius:19px 19px 0 0;padding:36px 28px 30px">${top}</td></tr>`
    + `<tr><td style="padding:30px 32px 32px">${body}</td></tr>`
    + '</table></td></tr>'
    + `<tr><td align="center" style="padding:22px 20px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED}">${footer}</td></tr>`
    + '</table></td></tr></table></body></html>';
}

function heading(eyebrow, text) {
  return `<p style="margin:18px 0 0;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${GREEN}">${escape(eyebrow)}</p>`
    + `<h1 style="margin:8px 0 0;font-family:${FONT};font-size:28px;font-weight:800;line-height:1.2;letter-spacing:-0.02em;color:${INK}">${escape(text)}</h1>`;
}

/** The invitation a new member receives. */
export function invitationEmailHtml({ origin, href, name, expiresAt }) {
  const signIn = `${origin}/auth`;
  return shell({
    title: 'Your invitation to SimplSEO',
    preview: 'Your spot in SimplSEO’s private early access is ready. No code to enter.',
    top: dot(64) + heading('Private early access', 'You’re invited to SimplSEO'),
    body: `<p style="margin:0;font-family:${FONT};font-size:16px;line-height:1.6;color:${INK}">Hi${name ? ` ${escape(name)}` : ''}, your spot in SimplSEO’s private early access is ready.</p>`
      + `<p style="margin:12px 0 26px;font-family:${FONT};font-size:16px;line-height:1.6;color:${INK}">Accept your invitation and choose the Google account you want to use. There is no code to enter.</p>`
      + button(href, 'Accept invitation')
      + `<p style="margin:14px 0 0;text-align:center;font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED}">This one-use invitation expires on ${escape(longDate(expiresAt))}.</p>`
      + `<div style="height:1px;line-height:1px;font-size:0;background:${LINE};margin:28px 0 24px">&nbsp;</div>`
      + `<p style="margin:0 0 16px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${MUTED}">What happens next</p>`
      + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
      + step(1, 'Accept and sign in', 'Choose the Google account you want to use for SimplSEO.')
      + step(2, 'Connect Search Console', 'It can be a different Google account. If you have not set it up yet, we’ll guide you.')
      + step(3, 'Open your dashboard', 'Finish the short setup and your SEO workspace is ready.')
      + '</table>'
      + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#f5f8f6" style="background:#f5f8f6;border-radius:12px;padding:14px 16px;font-family:${FONT};font-size:13px;line-height:1.55;color:${MUTED}"><strong style="color:${INK}">Keep this link private.</strong> It joins the first verified account that accepts it.</td></tr></table>`
      + `<p style="margin:20px 0 0;text-align:center;font-family:${FONT};font-size:14px;line-height:1.5;color:${MUTED}">Already joined? <a href="${escape(signIn)}" style="color:${GREEN};font-weight:700;text-decoration:underline">Sign in</a></p>`,
    footer: 'SimplSEO · SEO software for small business owners<br>You received this because an invitation to SimplSEO was sent to this address. If you weren’t expecting it, you can ignore this email.',
  });
}

/** The notice the administrator receives when someone asks to join. */
export function requestEmailHtml({ origin, href, email, name, company, reason }) {
  return shell({
    title: 'SimplSEO: new early-access request',
    preview: `${name || email} asked to join SimplSEO.`,
    top: dot(52) + heading('Early access', 'Someone wants in'),
    body: `<p style="margin:0 0 18px;font-family:${FONT};font-size:16px;line-height:1.6;color:${INK}">A new early-access request is waiting for you.</p>`
      + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${LINE}">`
      + detail('Email', email) + detail('Name', name || 'Not provided') + detail('Business', company || 'Not provided') + detail('Message', reason || 'Not provided')
      + '</table>'
      + '<div style="height:26px;line-height:26px;font-size:0">&nbsp;</div>'
      + button(href, 'Review access requests')
      + `<p style="margin:14px 0 0;text-align:center;font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED}">Nobody gets in until you approve them on that page.</p>`,
    footer: `SimplSEO · administrator notice<br><a href="${escape(`${origin}/auth`)}" style="color:${MUTED};text-decoration:underline">Sign in to your account</a>`,
  });
}
