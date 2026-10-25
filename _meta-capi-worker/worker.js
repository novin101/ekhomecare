/**
 * Ever Kind Home Care — Meta Conversions API relay (Cloudflare Worker)
 *
 * The website can't hold Meta's access token (anyone could read it), so
 * the browser sends events here and this worker forwards them to Meta
 * with the token kept as a secret.
 *
 * Settings (wrangler.toml / Cloudflare dashboard):
 *   PIXEL_ID           your Pixel / dataset ID              (variable)
 *   META_ACCESS_TOKEN  Conversions API access token         (SECRET)
 *   ALLOWED_ORIGINS    comma-separated site origins          (variable)
 *   GRAPH_VERSION      Graph API version, e.g. v26.0         (variable)
 *   TEST_EVENT_CODE    optional, from Events Manager "Test events"
 */

const ALLOWED_EVENTS = new Set(['PageView', 'Lead', 'Contact']);
const HASH = /^[a-f0-9]{64}$/;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const okOrigin = allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': okOrigin ? origin : allowed[0] || '',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST' || !okOrigin) return new Response('Forbidden', { status: 403, headers: cors });

    let body;
    try { body = await request.json(); } catch { return new Response('Bad JSON', { status: 400, headers: cors }); }

    const name = body.event_name;
    if (!ALLOWED_EVENTS.has(name)) return new Response('Unknown event', { status: 400, headers: cors });

    // Only accept the event's page from our own site.
    let sourceUrl;
    try {
      const u = new URL(body.event_source_url);
      if (!allowed.includes(u.origin)) throw new Error();
      sourceUrl = u.origin + u.pathname + u.search;
    } catch { return new Response('Bad source URL', { status: 400, headers: cors }); }

    const ud = body.user_data || {};
    const user_data = {
      client_ip_address: request.headers.get('CF-Connecting-IP') || undefined,
      client_user_agent: request.headers.get('User-Agent') || undefined,
      fbp: typeof ud.fbp === 'string' ? ud.fbp.slice(0, 200) : undefined,
      fbc: typeof ud.fbc === 'string' ? ud.fbc.slice(0, 500) : undefined,
    };
    // Email, phone and city arrive already SHA-256 hashed by the browser.
    if (HASH.test(ud.em || '')) user_data.em = [ud.em];
    if (HASH.test(ud.ph || '')) user_data.ph = [ud.ph];
    if (HASH.test(ud.ct || '')) user_data.ct = [ud.ct];
    if (user_data.em || user_data.ph) {
      // Every lead is in California, USA (pre-hashed constants of "ca" and "us").
      user_data.st = ['6959097001d10501ac7d54c0bdb8db61420f658f2922cc26e46d536119a31126'];
      user_data.country = ['79adb2a2fce5c6ba215fe5f27f532d4e7edbac4b6a5e09e1ef3a08084a904621'];
    }

    const payload = {
      data: [{
        event_name: name,
        event_time: Math.floor(Date.now() / 1000),
        event_id: typeof body.event_id === 'string' ? body.event_id.slice(0, 100) : undefined,
        event_source_url: sourceUrl,
        action_source: 'website',
        user_data,
      }],
    };
    if (env.TEST_EVENT_CODE) payload.test_event_code = env.TEST_EVENT_CODE;

    const version = env.GRAPH_VERSION || 'v26.0';
    const res = await fetch(
      `https://graph.facebook.com/${version}/${env.PIXEL_ID}/events?access_token=${encodeURIComponent(env.META_ACCESS_TOKEN)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );

    if (!res.ok) console.log('Meta error', res.status, await res.text());
    return new Response(res.ok ? 'ok' : 'error', { status: res.ok ? 200 : 502, headers: cors });
  },
};
