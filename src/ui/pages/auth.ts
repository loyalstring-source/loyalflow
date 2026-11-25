import { html, when, type Raw, type HtmlValue } from '../../lib/html.ts';
import { publicPage, page, type View } from '../layout.ts';
import { icon, field, input, notice, brand } from '../components.ts';

/** Flowing ribbons with a line of light through them, for the sign-in pages. */
function waves(): Raw {
  return html`<svg class="si-waves" viewBox="0 0 1000 560" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
    <defs>
      <linearGradient id="w-teal" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0E7C6B" stop-opacity=".0"/><stop offset=".3" stop-color="#0E7C6B" stop-opacity=".9"/><stop offset=".65" stop-color="#0A5E63"/><stop offset="1" stop-color="#2F9FB8" stop-opacity=".85"/></linearGradient>
      <linearGradient id="w-sky" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8AD3E6" stop-opacity="0"/><stop offset=".35" stop-color="#6CC6DC" stop-opacity=".8"/><stop offset=".7" stop-color="#2E9BC0" stop-opacity=".9"/><stop offset="1" stop-color="#9ADBEA" stop-opacity=".9"/></linearGradient>
      <linearGradient id="w-pale" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#CFEDEA" stop-opacity="0"/><stop offset=".4" stop-color="#CFEDEA" stop-opacity=".75"/><stop offset="1" stop-color="#E6F4F6" stop-opacity=".9"/></linearGradient>
      <linearGradient id="w-gold" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#F3D58A" stop-opacity="0"/><stop offset=".6" stop-color="#F0CC78" stop-opacity=".55"/><stop offset="1" stop-color="#E8B95A" stop-opacity=".85"/></linearGradient>
      <linearGradient id="w-line" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/><stop offset=".25" stop-color="#FFF6DA" stop-opacity=".95"/><stop offset="1" stop-color="#FFFFFF" stop-opacity=".9"/></linearGradient>
      <radialGradient id="w-dot"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".45" stop-color="#FFF4CF"/><stop offset="1" stop-color="#FFE9A8" stop-opacity="0"/></radialGradient>
      <filter id="w-soft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="14"/></filter>
    </defs>
    <path d="M1000 40 C860 120 800 300 640 330 C470 362 300 300 60 470 L60 560 L1000 560 Z" fill="url(#w-pale)" filter="url(#w-soft)" opacity=".8"/>
    <path d="M1000 20 C900 60 850 200 760 300 C720 345 690 360 660 368 C800 330 900 240 1000 200 Z" fill="url(#w-gold)"/>
    <path d="M40 520 C200 400 330 380 470 384 C640 388 700 330 820 210 C880 150 940 110 1000 100 L1000 260 C900 262 840 300 760 350 C640 425 520 440 380 440 C260 440 150 470 40 520 Z" fill="url(#w-sky)"/>
    <path d="M0 480 C120 380 250 300 420 285 C560 272 640 318 740 340 C830 360 920 330 1000 300 L1000 390 C900 400 820 420 700 410 C560 398 470 350 350 372 C230 394 110 440 0 480 Z" fill="url(#w-teal)"/>
    <path d="M1000 330 C900 345 830 380 720 388 C560 400 470 380 330 420 C230 448 150 480 60 540 L1000 560 Z" fill="url(#w-pale)" opacity=".9"/>
    <path d="M120 470 C210 420 250 410 300 400 C370 300 420 250 480 245 C590 236 620 300 700 300 C760 300 780 250 800 245 C850 150 900 105 960 96" fill="none" stroke="url(#w-line)" stroke-width="2" stroke-linecap="round"/>
    ${[[300, 400], [480, 245], [800, 245], [960, 96]].map(([x, y]) => html`<circle cx="${x}" cy="${y}" r="22" fill="url(#w-dot)" opacity=".9"/><circle cx="${x}" cy="${y}" r="8" fill="#FFFFFF"/>`)}
  </svg>`;
}

/** The frame every sign-in page sits in: company bar, the form on the left, the message and ribbons on the right. */
function shell(form: Raw): Raw {
  return html`<div class="si">
    <header class="si-top"><a class="si-brand" href="/login" aria-label="Loyal String"><img src="/static/ls-mark.png" width="66" height="49" alt=""><img src="/static/ls-word.png" width="178" height="21" alt="Loyal String"></a><span class="si-div" aria-hidden="true"></span><span class="si-prod">LoyalFlow</span><span class="si-div si-div-s" aria-hidden="true"></span><span class="si-prod">Workforce Management</span></header>
    <main class="si-main">
      <section class="si-form">${form}</section>
      <section class="si-hero" aria-hidden="true"><div class="si-msg"><p class="si-h">The future of work flows together.</p><p class="si-sub">Connected people. Clearer work. Greater momentum.</p><p class="si-vision">VISION 2030</p></div></section>
      ${waves()}
    </main>
    <footer class="si-foot">Loyal String International</footer>
  </div>`;
}

export function loginPage(o: { csrf: string; error?: string; email?: string; next?: string; info?: string }): Raw {
  return publicPage({ title: 'Sign in', body: shell(html`<form class="si-box" method="post" action="/login" autocomplete="on">
        <div><h1>Sign in to LoyalFlow</h1><p class="si-lead">Manage work. Move forward.</p></div>
        ${when(o.error, () => notice('crit', o.error!))}
        ${when(o.info, () => notice('good', o.info!))}
        <input type="hidden" name="_csrf" value="${o.csrf}"><input type="hidden" name="next" value="${o.next || ''}">
        <label class="si-field"><span>Work email</span><input class="si-input" type="email" name="email" id="f-email" value="${o.email || ''}" placeholder="Enter your work email" required autocomplete="username"></label>
        <label class="si-field"><span>Password</span><span class="si-pass"><input class="si-input" type="password" name="password" id="f-password" placeholder="Enter your password" required autocomplete="current-password"><button class="si-eye" type="button" aria-label="Show password" aria-pressed="false" aria-controls="f-password"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/></svg></button></span></label>
        <div class="si-row"><label class="si-check"><input type="checkbox" name="remember" value="1"> Remember me</label><a href="/forgot-password">Forgot password?</a></div>
        <button class="si-btn" type="submit">Sign in</button>
        <details class="si-help"><summary>Need help signing in?</summary><p>Use your Loyal String work email. If you have forgotten your password, choose "Forgot password?" and a reset link is sent to that email. Five wrong attempts lock the account for 15 minutes. If you still cannot get in, ask your LoyalFlow administrator.</p></details>
      </form>
      <script>(function () { var b = document.querySelector('.si-eye'), i = document.getElementById('f-password'); if (!b || !i) return; b.addEventListener('click', function () { var show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.setAttribute('aria-pressed', show ? 'true' : 'false'); b.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); }); })();</script>`) });
}

export function forgotPage(o: { csrf: string; sent?: boolean; demoLink?: string | null }): Raw {
  return publicPage({ title: 'Reset password', body: shell(html`
    <form class="si-box form" method="post" action="/forgot-password">
      <div><h1>Reset your password</h1><p class="si-lead">We will email a link that works for 60 minutes.</p></div>
      ${when(o.sent, () => notice('good', html`If that address belongs to an employee, the reset link is on its way.${when(o.demoLink, () => html`<br><span class="small">Demo mode, no mail server: <a href="${o.demoLink}">open the reset link</a>.</span>`)}`))}
      <input type="hidden" name="_csrf" value="${o.csrf}">
      ${field('Work email', input('email', { type: 'email', required: true, placeholder: 'name@loyalstring.com', autocomplete: 'username' }))}
      <button class="si-btn" type="submit">Send reset link</button>
      <a class="small" href="/login" style="text-align:center">Back to sign in</a>
    </form>`) });
}

export function resetPage(o: { csrf: string; token: string; error?: string }): Raw {
  return publicPage({ title: 'Choose a new password', body: shell(html`
    <form class="si-box form" method="post" action="/reset-password">
      <div><h1>Choose a new password</h1><p class="si-lead">At least 10 characters with a letter and a number.</p></div>
      ${when(o.error, () => notice('crit', o.error!))}
      <input type="hidden" name="_csrf" value="${o.csrf}"><input type="hidden" name="token" value="${o.token}">
      ${field('New password', input('password', { type: 'password', required: true, autocomplete: 'new-password' }))}
      ${field('Repeat it', input('password2', { type: 'password', required: true, autocomplete: 'new-password' }))}
      <button class="si-btn" type="submit">Save password</button>
    </form>`) });
}

export function changePasswordPage(v: View, o: { error?: string; forced?: boolean }): Raw {
  return page(v, { title: o.forced ? 'Set your own password' : 'Change password', noSearch: true, body: html`<div class="card" style="max-width:520px">
    ${when(o.forced, () => notice('accent', 'Welcome to LoyalFlow! Please replace the starter password with one only you know.'))}
    ${when(o.error, () => notice('crit', o.error!))}
    <form class="form" method="post" action="/change-password" style="margin-top:16px">
      <input type="hidden" name="_csrf" value="${v.csrf}">
      ${when(!o.forced, () => field('Current password', input('current', { type: 'password', required: true, autocomplete: 'current-password' })))}
      ${field('New password', input('password', { type: 'password', required: true, autocomplete: 'new-password' }), 'At least 10 characters with a letter and a number. Not your previous password.')}
      ${field('Repeat new password', input('password2', { type: 'password', required: true, autocomplete: 'new-password' }))}
      <button class="btn btn-primary btn-lg" type="submit">Save password</button>
    </form></div>` });
}

export function ratePage(o: { ticketId: string; subject: string; customer: string; rating: number | null; done?: boolean; invalid?: boolean }): Raw {
  const stars: HtmlValue[] = [1, 2, 3, 4, 5].map((n) => html`<a class="btn ${o.rating === n ? 'btn-primary' : ''}" href="?r=${n}" style="width:48px;font-size:18px" aria-label="${n} star">${n}</a>`);
  return publicPage({ title: 'Rate our support', body: html`<div style="max-width:560px;margin:48px auto;padding:0 16px"><div class="card" style="display:flex;flex-direction:column;gap:14px;align-items:flex-start">
    <span class="pill pill-accent">${o.ticketId}</span>
    ${o.invalid ? html`<h1>This rating link has expired</h1><p class="muted">The ticket may have been reopened or already rated. Thank you for taking the time.</p>` : o.done ? html`<h1>Thank you, ${o.customer}!</h1><p class="muted">Your rating of ${o.rating} out of 5 for "${o.subject}" has been recorded and shared with the support team.</p>` : html`<h1>How did we do?</h1><p class="muted">${o.customer}, please rate the support you received on "${o.subject}". 5 is excellent.</p><div class="row">${stars}</div><p class="small faint">Click a number to submit. One click is all it takes.</p>`}
  </div></div>` });
}
