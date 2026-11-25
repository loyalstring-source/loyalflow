/* LoyalFlow client: progressive enhancement over server-rendered pages. No framework, no build step. */
(function () {
  'use strict';
  var cfgEl = document.getElementById('lf-config');
  var CFG = cfgEl ? JSON.parse(cfgEl.textContent || '{}') : {};
  var CSRF = CFG.csrf || '';
  var FLASH_KEY = 'lf.flash';
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------- toasts, confetti, flash ---------- */
  function toast(o) {
    var root = document.getElementById('toast-root'); if (!root) return;
    var kind = o.kind || 'info';
    var colour = kind === 'success' ? '#1E8E5A' : kind === 'warn' ? '#A45D00' : kind === 'critical' ? '#C8323B' : '#2F55D4';
    var sym = kind === 'success' ? '✓' : kind === 'warn' ? '!' : kind === 'critical' ? '✕' : 'i';
    var el = document.createElement('div');
    el.className = 'toast'; el.setAttribute('role', 'status');
    el.innerHTML = '<span class="ico" style="background:' + colour + '">' + sym + '</span><span style="min-width:0"><b></b><span></span></span>';
    el.querySelector('b').textContent = o.title || '';
    el.querySelector('span span').textContent = o.body || '';
    root.appendChild(el);
    setTimeout(function () { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; setTimeout(function () { el.remove(); }, 450); }, o.ms || 4200);
  }
  function confetti() {
    var wrap = document.createElement('div'); wrap.className = 'confetti';
    var colours = ['#2F55D4', '#1E8E5A', '#FF6B4A', '#6B4EE6', '#F4B400', '#9DB4FF'];
    for (var i = 0; i < 90; i++) {
      var p = document.createElement('i');
      p.style.left = Math.random() * 100 + 'vw';
      p.style.background = colours[i % colours.length];
      p.style.animationDelay = (Math.random() * 0.6) + 's';
      p.style.animationDuration = (1.3 + Math.random() * 1.2) + 's';
      p.style.transform = 'rotate(' + Math.random() * 360 + 'deg)';
      wrap.appendChild(p);
    }
    document.body.appendChild(wrap);
    setTimeout(function () { wrap.remove(); }, 3200);
  }
  function setFlash(data) { try { sessionStorage.setItem(FLASH_KEY, JSON.stringify(data)); } catch (e) { /* private mode */ } }
  function playFlash() {
    var raw; try { raw = sessionStorage.getItem(FLASH_KEY); sessionStorage.removeItem(FLASH_KEY); } catch (e) { return; }
    if (!raw) return;
    try { var f = JSON.parse(raw); if (f.toast) toast(f.toast); if (f.confetti) confetti(); } catch (e) { /* ignore */ }
  }

  /* ---------- network ---------- */
  function post(url, body) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Requested-With': 'LoyalFlow', 'X-CSRF': CSRF },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json().catch(function () { return { ok: false, error: 'Unexpected response (' + r.status + ')' }; }).then(function (j) { if (!r.ok && !j.error) j.error = 'Request failed (' + r.status + ')'; return j; }); })
      .catch(function (e) { return { ok: false, error: 'Network problem: ' + (e && e.message || e) }; });
  }
  function handle(res, origin) {
    if (!res) return;
    if (res.error && !res.ok) { toast({ kind: 'critical', title: 'That did not work', body: res.error }); return; }
    if (res.html && res.target) { var t = $(res.target); if (t) { t.innerHTML = res.html; animateRings(t); initMotion(t); } }
    if (res.close) closeDrawer();
    if (res.redirect) { setFlash({ toast: res.toast, confetti: res.confetti }); window.location.href = res.redirect; return; }
    if (res.reload) { setFlash({ toast: res.toast, confetti: res.confetti }); window.location.reload(); return; }
    if (res.toast) toast(res.toast);
    if (res.confetti) confetti();
    if (res.drawer) openDrawerHtml(res.drawer);
    if (origin && res.ok && origin.hasAttribute('data-burst')) {
      var br = origin.getBoundingClientRect();
      burst(br.left + br.width / 2, br.top + br.height / 2, origin.getAttribute('data-burst') || 'var(--good)');
    }
    if (origin && origin.getAttribute('data-remove-on-success') && res.ok) {
      var row = origin.closest(origin.getAttribute('data-remove-on-success'));
      if (row) { row.classList.add('lf-leaving'); setTimeout(function () { row.remove(); }, 360); }
    }
  }

  /* ---------- drawer & modal ---------- */
  var drawerRoot = document.getElementById('drawer-root'), drawerEl = document.getElementById('drawer');
  var modalRoot = document.getElementById('modal-root'), modalEl = document.getElementById('modal');
  function openDrawerHtml(h) { if (!drawerEl) return; drawerEl.innerHTML = h; drawerRoot.classList.add('open'); drawerRoot.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; animateRings(drawerEl); var f = $('[autofocus]', drawerEl); if (f) f.focus(); }
  /* A panel closed while its content is still loading must stay closed: on a slow
     connection the late response used to pop the panel back open under the user. */
  var drawerSeq = 0, modalSeq = 0;
  function openDrawer(url) {
    if (!drawerEl) { window.location.href = url.replace(/[?&]partial=1/, ''); return; }
    var u = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'partial=1';
    var mine = ++drawerSeq;
    drawerEl.innerHTML = '<div class="drawer-body"><div class="empty">Loading…</div></div>';
    drawerRoot.classList.add('open'); drawerRoot.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden';
    fetch(u, { credentials: 'same-origin', headers: { 'X-Requested-With': 'LoyalFlow-partial' } }).then(function (r) { return r.text(); })
      .then(function (h) { if (mine === drawerSeq) openDrawerHtml(h); })
      .catch(function () { if (mine === drawerSeq) drawerEl.innerHTML = '<div class="drawer-body"><div class="notice notice-crit">Could not load. Check your connection.</div></div>'; });
  }
  function closeDrawer() { if (!drawerRoot) return; drawerSeq++; drawerRoot.classList.remove('open'); drawerRoot.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; }
  function openModal(url) {
    if (!modalEl) { window.location.href = url; return; }
    var u = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'partial=1';
    var mine = ++modalSeq;
    modalEl.innerHTML = '<div class="empty">Loading…</div>'; modalRoot.classList.add('open'); modalRoot.setAttribute('aria-hidden', 'false');
    fetch(u, { credentials: 'same-origin', headers: { 'X-Requested-With': 'LoyalFlow-partial' } }).then(function (r) { return r.text(); })
      .then(function (h) { if (mine !== modalSeq) return; modalEl.innerHTML = h; var f = $('input:not([type=hidden]),select,textarea', modalEl); if (f) f.focus(); });
  }
  function closeModal() { if (!modalRoot) return; modalSeq++; modalRoot.classList.remove('open'); modalRoot.setAttribute('aria-hidden', 'true'); }

  /* ---------- forms ---------- */
  function fileToBase64(file) { return new Promise(function (resolve, reject) { var r = new FileReader(); r.onload = function () { resolve(String(r.result).split(',')[1] || ''); }; r.onerror = reject; r.readAsDataURL(file); }); }
  function serialize(form) {
    var out = {}, waits = [];
    $$('input,select,textarea', form).forEach(function (el) {
      if (!el.name || el.disabled) return;
      if (el.type === 'checkbox') {
        if (el.name.slice(-2) === '[]') { (out[el.name.slice(0, -2)] = out[el.name.slice(0, -2)] || []); if (el.checked) out[el.name.slice(0, -2)].push(el.value); }
        // Several checkboxes sharing one name (a panel, a list of applicants) are a list of the ticked values.
        else if (form.querySelectorAll('input[type=checkbox][name="' + el.name + '"]').length > 1) { out[el.name] = out[el.name] || []; if (el.checked) out[el.name].push(el.value); }
        else out[el.name] = el.checked;
        return;
      }
      if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; return; }
      if (el.type === 'file') { if (el.files && el.files[0]) { var f = el.files[0]; waits.push(fileToBase64(f).then(function (b) { out[el.name] = b; out[el.name + 'Name'] = f.name; })); } return; }
      if (el.type === 'number') { out[el.name] = el.value === '' ? null : Number(el.value); return; }
      out[el.name] = el.value;
    });
    return Promise.all(waits).then(function () { return out; });
  }
  function getPosition(timeoutMs) {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) { resolve(null); return; }
      var done = false; var t = setTimeout(function () { if (!done) { done = true; resolve(null); } }, timeoutMs || 6000);
      navigator.geolocation.getCurrentPosition(function (p) { if (done) return; done = true; clearTimeout(t); resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); }, function () { if (done) return; done = true; clearTimeout(t); resolve(null); }, { enableHighAccuracy: true, timeout: timeoutMs || 6000, maximumAge: 30000 });
    });
  }
  function submitAjax(form) {
    var btn = $('[type=submit]', form); if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Saving…'; }
    var needsGps = form.hasAttribute('data-gps');
    return serialize(form).then(function (body) {
      if (!needsGps) return body;
      return getPosition().then(function (pos) { if (pos) { body.lat = pos.lat; body.lng = pos.lng; body.accuracy = pos.accuracy; } else if (form.getAttribute('data-gps') === 'required') { throw new Error('Location is required for a visit. Please allow location access and try again.'); } return body; });
    }).then(function (body) { return post(form.getAttribute('action') || form.getAttribute('data-post'), body); })
      .then(function (res) { handle(res, form); if (res && res.ok && form.hasAttribute('data-reset')) form.reset(); })
      .catch(function (e) { toast({ kind: 'critical', title: 'Could not submit', body: e.message || String(e) }); })
      .then(function () { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label; } });
  }

  /* ---------- rings & misc animation ---------- */
  function animateRings(root) {
    $$('.ring-fg', root).forEach(function (c) {
      var target = c.getAttribute('data-target-offset'); if (target === null) return;
      requestAnimationFrame(function () { setTimeout(function () { c.style.strokeDashoffset = target; }, 60); });
    });
    $$('.bar > span[data-width]', root).forEach(function (b) { setTimeout(function () { b.style.width = b.getAttribute('data-width'); }, 60); });
  }

  /* ---------- event delegation ---------- */
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('[data-post],[data-drawer],[data-modal],[data-close-drawer],[data-close-modal],.js-close-modal,[data-chips] .chip,[data-toggle],[data-lang],[data-copy]') : null;
    if (!t) return;
    // A form that carries data-post is sent by its submit event (below), with its fields. A click inside it is just a click.
    if (t.tagName === 'FORM') return;
    if (t.classList.contains('js-close-modal')) { ev.preventDefault(); closeModal(); return; }
    if (t.hasAttribute('data-close-drawer')) { ev.preventDefault(); closeDrawer(); return; }
    if (t.hasAttribute('data-close-modal')) { ev.preventDefault(); closeModal(); return; }
    if (t.hasAttribute('data-drawer')) { ev.preventDefault(); openDrawer(t.getAttribute('data-drawer')); return; }
    if (t.hasAttribute('data-modal')) { ev.preventDefault(); openModal(t.getAttribute('data-modal')); return; }
    if (t.hasAttribute('data-toggle')) { ev.preventDefault(); var tg = $(t.getAttribute('data-toggle')); if (tg) tg.hidden = !tg.hidden; return; }
    if (t.hasAttribute('data-copy')) { ev.preventDefault(); navigator.clipboard && navigator.clipboard.writeText(t.getAttribute('data-copy')).then(function () { toast({ kind: 'success', title: 'Copied' }); }); return; }
    if (t.hasAttribute('data-lang')) { ev.preventDefault(); post('/me/lang', { lang: t.getAttribute('data-lang') }).then(function () { window.location.reload(); }); return; }
    if (t.classList.contains('chip')) {
      var group = t.closest('[data-chips]'); var hidden = $('input[type=hidden]', group);
      $$('.chip', group).forEach(function (c) { c.classList.remove('on'); }); t.classList.add('on'); hidden.value = t.getAttribute('data-value');
      hidden.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (t.hasAttribute('data-post')) {
      ev.preventDefault();
      var msg = t.getAttribute('data-confirm'); if (msg && !window.confirm(msg)) return;
      var body = {}; try { body = JSON.parse(t.getAttribute('data-body') || '{}'); } catch (e) { body = {}; }
      var prompt = t.getAttribute('data-prompt'); if (prompt) { var val = window.prompt(prompt); if (val === null) return; body[t.getAttribute('data-prompt-key') || 'note'] = val; }
      t.disabled = true;
      if (t.tagName === 'BUTTON') t.setAttribute('data-busy', '1');
      var run = function (b) { return post(t.getAttribute('data-post'), b).then(function (res) { t.disabled = false; t.removeAttribute('data-busy'); handle(res, t); }); };
      if (t.hasAttribute('data-gps')) getPosition().then(function (pos) { if (pos) { body.lat = pos.lat; body.lng = pos.lng; } return run(body); }); else run(body);
    }
  });
  document.addEventListener('submit', function (ev) {
    var form = ev.target; if (!form.hasAttribute || !(form.hasAttribute('data-ajax') || form.hasAttribute('data-post'))) return;
    ev.preventDefault(); submitAjax(form);
  });
  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (el.hasAttribute && el.hasAttribute('data-autosubmit')) { var f = el.closest('form'); if (f) { if (f.hasAttribute('data-ajax')) submitAjax(f); else f.submit(); } }
    if (el.hasAttribute && el.hasAttribute('data-show')) { var target = $(el.getAttribute('data-show')); if (target) target.hidden = !(el.value === el.getAttribute('data-show-when')); }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { closeDrawer(); closeModal(); return; }
    if (ev.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) { var s = document.getElementById('global-search'); if (s) { ev.preventDefault(); s.focus(); } }
  });
  if (drawerRoot) drawerRoot.addEventListener('click', function (ev) { if (ev.target === drawerRoot) closeDrawer(); });
  if (modalRoot) modalRoot.addEventListener('click', function (ev) { if (ev.target === modalRoot) closeModal(); });

  /* ---------- v1.4 motion layer ---------- */
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Numbers count up to their value. Reads as the figure settling, not a slot machine:
     one easing curve, under a second, and the final frame is always the exact text. */
  function countUp(el) {
    var target = el.getAttribute('data-countup');
    if (target === null) return;
    var end = parseFloat(target);
    if (!isFinite(end) || calm) { return; }
    var prefix = el.getAttribute('data-prefix') || '', suffix = el.getAttribute('data-suffix') || '';
    var dp = Number(el.getAttribute('data-dp') || 0), group = el.getAttribute('data-group') !== 'off';
    var final = el.textContent, t0 = 0, dur = Math.min(1000, 420 + Math.abs(end) % 400);
    var fmt = function (n) {
      var v = dp ? n.toFixed(dp) : String(Math.round(n));
      if (group) { var parts = v.split('.'); parts[0] = Number(parts[0]).toLocaleString('en-IN'); v = parts.join('.'); }
      return prefix + v + suffix;
    };
    var step = function (ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      if (p < 1) { el.textContent = fmt(end * e); requestAnimationFrame(step); } else { el.textContent = final; }
    };
    el.textContent = fmt(0);
    requestAnimationFrame(step);
  }

  /* The glow inside a tile follows the pointer. Pure CSS variables, no layout work. */
  function trackPointer(el) {
    el.addEventListener('pointermove', function (ev) {
      var r = el.getBoundingClientRect();
      el.style.setProperty('--mx', ((ev.clientX - r.left) / r.width * 100) + '%');
      el.style.setProperty('--my', ((ev.clientY - r.top) / r.height * 100) + '%');
    });
  }

  /* Eight particles from a point. Used for an approval or a check-in, not for saves. */
  function burst(x, y, colour) {
    if (calm) return;
    for (var i = 0; i < 8; i++) {
      var a = (Math.PI * 2 * i) / 8 + Math.random() * 0.5, dist = 34 + Math.random() * 28;
      var p = document.createElement('span');
      p.className = 'lf-burst';
      p.style.left = x + 'px'; p.style.top = y + 'px';
      p.style.background = colour || 'var(--good)';
      p.style.setProperty('--dx', Math.cos(a) * dist + 'px');
      p.style.setProperty('--dy', Math.sin(a) * dist + 'px');
      p.style.animationDelay = (i * 8) + 'ms';
      document.body.appendChild(p);
      setTimeout(function (n) { return function () { n.remove(); }; }(p), 820);
    }
  }

  /* Things below the fold wait until they are nearly on screen. */
  function revealOnScroll() {
    var items = $$('.reveal');
    if (!items.length) return;
    var showAll = function () { items.forEach(function (el) { el.classList.add('in'); }); };
    if (calm || !('IntersectionObserver' in window)) { showAll(); return; }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target, sibs = Array.prototype.slice.call(el.parentNode.children).indexOf(el);
        setTimeout(function () { el.classList.add('in'); }, Math.min(sibs, 6) * 55);
        io.unobserve(el);
      });
    }, { rootMargin: '140px 0px 140px 0px', threshold: 0.01 });
    items.forEach(function (el) { io.observe(el); });

    /* Three ways a hidden section would otherwise stay hidden: printing, a PDF or
       screenshot that never scrolls, and any browser where the observer misfires.
       Content is never allowed to depend on an animation having run. */
    window.addEventListener('beforeprint', showAll);
    setTimeout(showAll, 2500);
  }

  /* A live clock in the hero, to the minute. */
  function heroClock() {
    var el = $('[data-clock]');
    if (!el) return;
    var tick = function () {
      el.textContent = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
    };
    tick(); setInterval(tick, 15000);
  }

  function initMotion(root) {
    $$('[data-countup]', root).forEach(countUp);
    $$('.tile', root).forEach(trackPointer);
  }

  /* ---------- auto-open drawer from hash, autorefresh, PWA ---------- */
  function boot() {
    playFlash(); animateRings(document);
    initMotion(document); revealOnScroll(); heroClock();
    var open = document.body.getAttribute('data-open-drawer'); if (open) openDrawer(open);
    if (location.hash && /^#open=/.test(location.hash)) openDrawer(decodeURIComponent(location.hash.slice(6)));
    var refresh = document.body.getAttribute('data-autorefresh');
    if (refresh) setInterval(function () { if (!drawerRoot.classList.contains('open') && !modalRoot.classList.contains('open') && !/input|textarea|select/i.test(document.activeElement.tagName) && document.visibilityState === 'visible') window.location.reload(); }, Number(refresh) * 1000);
    $$('[data-countdown]').forEach(function (el) {
      var due = new Date(el.getAttribute('data-countdown')).getTime();
      var tick = function () { var m = Math.round((due - Date.now()) / 60000); el.textContent = (m < 0 ? '-' : '') + (Math.abs(m) < 60 ? Math.abs(m) + ' min' : Math.floor(Math.abs(m) / 60) + ':' + String(Math.abs(m) % 60).padStart(2, '0') + ' h'); };
      tick(); setInterval(tick, 30000);
    });
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(function () { /* optional */ });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.LF = { post: post, toast: toast, confetti: confetti, burst: burst, initMotion: initMotion, openDrawer: openDrawer, closeDrawer: closeDrawer, openModal: openModal, closeModal: closeModal };
})();

/* ---------- Boards: drag a tile to another column, or write a remark on the tile ---------- */
(function () {
  var dlg = null, state = null;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function open(board, card, to) {
    var cols = [].slice.call(board.querySelectorAll('[data-drop]')); var from = card.getAttribute('data-col');
    state = { url: board.getAttribute('data-board') + encodeURIComponent(card.getAttribute('data-card')) + '/move' };
    if (!dlg) { dlg = document.createElement('dialog'); dlg.className = 'board-dlg'; document.body.appendChild(dlg); dlg.addEventListener('close', function () { state = null; }); }
    dlg.innerHTML = '<form method="dialog" class="form"><h2>' + (to ? 'Move' : 'Remark') + '</h2><p class="small muted" style="margin:0">' + esc(card.getAttribute('data-card-title') || '') + '</p>' +
      '<label class="field"><span>Move to</span><select class="input" name="to"><option value="">Leave where it is</option>' + cols.filter(function (c) { return c.getAttribute('data-drop') !== from; }).map(function (c) { var k = c.getAttribute('data-drop'); return '<option value="' + esc(k) + '"' + (k === to ? ' selected' : '') + '>' + esc(c.getAttribute('data-drop-label')) + '</option>'; }).join('') + '</select></label>' +
      '<label class="field"><span>Remark' + (to ? ' (optional)' : '') + '</span><textarea class="input" name="note" rows="3" maxlength="1000" placeholder="What was done, or what is needed next"></textarea></label>' +
      '<div class="row" style="justify-content:flex-end;gap:8px"><button class="btn" type="button" data-x>Cancel</button><button class="btn btn-primary" type="submit">' + (to ? 'Move' : 'Save') + '</button></div></form>';
    dlg.querySelector('[data-x]').addEventListener('click', function () { dlg.close(); });
    dlg.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault(); if (!state) return; var f = e.target; var body = { to: f.to.value, note: f.note.value }; var btn = f.querySelector('[type=submit]');
      if (!body.to && !body.note.trim()) { f.note.focus(); return; }
      btn.disabled = true;
      window.LF.post(state.url, body).then(function (res) {
        if (res && res.ok) { dlg.close(); window.location.reload(); }
        else { btn.disabled = false; window.LF.toast({ kind: 'critical', title: 'Not moved', body: (res && res.error) || 'Try again.' }); }
      });
    });
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    var n = dlg.querySelector(to ? 'textarea' : 'textarea'); if (n) n.focus();
  }
  var dragging = null;
  document.addEventListener('dragstart', function (e) { var c = e.target.closest && e.target.closest('[data-card]'); if (!c || !c.closest('[data-board]')) return; dragging = c; c.classList.add('is-dragging'); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.getAttribute('data-card')); } catch (x) {} });
  document.addEventListener('dragend', function () { if (dragging) dragging.classList.remove('is-dragging'); dragging = null; document.querySelectorAll('.drop-on').forEach(function (c) { c.classList.remove('drop-on'); }); });
  document.addEventListener('dragover', function (e) { if (!dragging) return; var col = e.target.closest && e.target.closest('[data-drop]'); document.querySelectorAll('.drop-on').forEach(function (c) { if (c !== col) c.classList.remove('drop-on'); }); if (!col || col.closest('[data-board]') !== dragging.closest('[data-board]')) return; e.preventDefault(); if (col.getAttribute('data-drop') !== dragging.getAttribute('data-col')) col.classList.add('drop-on'); });
  document.addEventListener('drop', function (e) { if (!dragging) return; var col = e.target.closest && e.target.closest('[data-drop]'); var card = dragging; if (!col) return; e.preventDefault(); col.classList.remove('drop-on'); if (col.getAttribute('data-drop') === card.getAttribute('data-col')) return; open(card.closest('[data-board]'), card, col.getAttribute('data-drop')); });
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-card-remark]'); if (!b) return; e.preventDefault(); e.stopPropagation(); var card = b.closest('[data-card]'); if (card) open(card.closest('[data-board]'), card, ''); });
})();
