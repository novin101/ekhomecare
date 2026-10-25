/*
 * Ever Kind Home Care — Meta Pixel + Conversions API (browser side)
 *
 * Setup: paste your Pixel ID below. Once the Conversions API worker is
 * deployed (see _meta-capi-worker/README.md), paste its URL into
 * CAPI_ENDPOINT. Until PIXEL_ID is set, this file does nothing.
 *
 * Events sent:
 *   PageView — every page load
 *   Lead     — a care request form was sent successfully
 *   Contact  — someone tapped a phone number
 *
 * Every event goes to both the Pixel and the Conversions API with the same
 * event ID, so Meta counts it once.
 *
 * What we send about a lead: hashed email, hashed phone and hashed city,
 * plus Meta's own browser cookies. We never send names, the "care needs"
 * text, or anything about a person's health.
 */
(function () {
  var PIXEL_ID = '2945933582410765';
  var CAPI_ENDPOINT = '';   // e.g. 'https://ek-meta-capi.YOUR-ACCOUNT.workers.dev'

  if (!PIXEL_ID) { window.ekTrack = function () {}; return; }

  // ---- Meta Pixel base code ----
  !function (f, b, e, v, n, t, s) {
    if (f.fbq) return; n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0';
    n.queue = []; t = b.createElement(e); t.async = !0; t.src = v;
    s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
  }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', PIXEL_ID);

  // ---- helpers ----
  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }
  function cookie(name) {
    var m = document.cookie.match('(?:^|; )' + name + '=([^;]*)');
    return m ? decodeURIComponent(m[1]) : undefined;
  }
  function sha256(str) {
    if (!str || !window.crypto || !crypto.subtle) return Promise.resolve(undefined);
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return ('0' + b.toString(16)).slice(-2);
      }).join('');
    });
  }
  // Normalize the way Meta expects before hashing.
  function normEmail(v) { v = (v || '').trim().toLowerCase(); return /@/.test(v) ? v : ''; }
  function normPhone(v) {
    v = (v || '').replace(/\D/g, '');
    if (v.length === 10) v = '1' + v;          // US numbers need the country code
    return v.length >= 11 ? v : '';
  }
  function normCity(v) {
    v = (v || '').toLowerCase().replace(/[^a-z]/g, '');
    return v && v.indexOf('other') !== 0 ? v : '';
  }

  // fbc is normally set by the Pixel; build it from the ad click id if not.
  function fbc() {
    var c = cookie('_fbc'); if (c) return c;
    var id = new URLSearchParams(location.search).get('fbclid');
    return id ? 'fb.1.' + Date.now() + '.' + id : undefined;
  }

  function sendServer(eventName, eventId, user) {
    if (!CAPI_ENDPOINT) return;
    var body = JSON.stringify({
      event_name: eventName,
      event_id: eventId,
      event_source_url: location.href.split('#')[0],
      user_data: {
        em: user.em, ph: user.ph, ct: user.ct,
        fbp: cookie('_fbp'), fbc: fbc()
      }
    });
    try {
      fetch(CAPI_ENDPOINT, {
        method: 'POST', body: body, keepalive: true,
        headers: { 'Content-Type': 'application/json' }
      }).catch(function () {});
    } catch (e) {}
  }

  // Public: ekTrack('Lead', {email, phone, city})
  window.ekTrack = function (eventName, info) {
    info = info || {};
    var eventId = newId();
    fbq('track', eventName, {}, { eventID: eventId });
    Promise.all([
      sha256(normEmail(info.email)),
      sha256(normPhone(info.phone)),
      sha256(normCity(info.city))
    ]).then(function (h) {
      sendServer(eventName, eventId, { em: h[0], ph: h[1], ct: h[2] });
    });
  };

  // ---- automatic events ----
  // PageView: wait a moment so the Pixel can set its _fbp cookie first.
  setTimeout(function () { window.ekTrack('PageView'); }, 600);

  // Contact: any tap on a phone link.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="tel:"]');
    if (a) window.ekTrack('Contact');
  });

  // City pages: their forms post straight to Formspree and leave the site,
  // so the Lead can't be measured. Send them in the background instead and
  // show a thank-you message in place, firing Lead only after a real success.
  // (The home page form already works this way and calls ekTrack itself.)
  function wireForm(form) {
    form.addEventListener('submit', function (e) {
      if (form.checkValidity && !form.checkValidity()) return; // let the browser show errors
      e.preventDefault();
      var btn = form.querySelector('[type=submit]'), label = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      var el = form.elements;
      var info = {
        email: el.email && el.email.value,
        phone: el.Phone && el.Phone.value,
        city: el.City && el.City.value
      };
      fetch(form.action, { method: 'POST', body: new FormData(form), headers: { 'Accept': 'application/json' } })
        .then(function (r) {
          if (!r.ok) throw new Error('bad');
          window.ekTrack('Lead', info);
          var msg = document.createElement('div');
          msg.setAttribute('role', 'status');
          msg.innerHTML = '<p><strong>Thank you.</strong> Our team will follow up as soon as possible. ' +
            'If it’s urgent, please call <a href="tel:9493913041">(949) 391-3041</a>.</p>';
          form.parentNode.replaceChild(msg, form);
        })
        .catch(function () {
          if (btn) { btn.disabled = false; btn.innerHTML = label; }
          alert('We couldn’t send your request. Please try again, or call (949) 391-3041.');
        });
    });
  }
  function init() {
    var forms = document.querySelectorAll('form[action*="formspree.io"]');
    for (var i = 0; i < forms.length; i++) {
      if (forms[i].id !== 'careForm') wireForm(forms[i]);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
