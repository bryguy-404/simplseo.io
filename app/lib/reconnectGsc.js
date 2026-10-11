import { authenticatedFetch } from './authenticatedFetch';

export async function reconnectGsc(property, { sessionRevision } = {}) {
  // Open synchronously from the click handler to avoid popup blockers.
  const popup = window.open('about:blank', 'gsc-auth', 'width=500,height=600');
  if (!popup) throw new Error('Allow popups for this site, then reconnect Google.');
  try {
    const params = new URLSearchParams();
    if (property) params.set('property', property);
    if (sessionRevision !== undefined) params.set('sessionRevision', String(sessionRevision));
    const start = await authenticatedFetch(`/api/gsc/connect${params.size ? `?${params}` : ''}`);
    const setup = await start.json();
    if (!start.ok) throw new Error(setup.error);
    const result = await new Promise((resolve, reject) => {
      let timer, timeout;
      const cleanup = () => { window.removeEventListener('message', handle); clearInterval(timer); clearTimeout(timeout); };
      const handle = event => {
        if (event.origin !== window.location.origin || event.source !== popup || !event.data || event.data.state !== setup.state) return;
        if (event.data.type === 'GSC_AUTH_SUCCESS') { cleanup(); resolve(event.data); }
        if (event.data.type === 'GSC_AUTH_ERROR') { cleanup(); reject(new Error('Google connection was cancelled or declined.')); }
      };
      window.addEventListener('message', handle);
      timer = setInterval(() => { if (popup.closed) { cleanup(); reject(new Error('Google connection was closed. Your previous connection is preserved.')); } }, 500);
      timeout = setTimeout(() => { cleanup(); reject(new Error('Google connection expired. Connect again. Your previous connection is preserved.')); }, 10 * 60000);
      popup.location.href = setup.url;
    });
    const exchange = await authenticatedFetch('/api/gsc/exchange-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: result.code, state: result.state }) });
    const data = await exchange.json();
    if (!exchange.ok) throw new Error(data.error);
    return data;
  } finally { popup.close(); }
}
