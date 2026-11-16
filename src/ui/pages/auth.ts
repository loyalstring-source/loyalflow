import { html, when, type Raw, type HtmlValue } from '../../lib/html.ts';
import { publicPage, page, type View } from '../layout.ts';
import { icon, field, input, notice, brand } from '../components.ts';

function brandPanel(): Raw {
  return html`<section class="login-brand" aria-hidden="true">
    <svg style="position:absolute;left:0;right:0;top:0;width:100%;height:62%" viewBox="0 0 800 460" preserveAspectRatio="xMidYMin meet">
      <defs><radialGradient id="g1" cx="30%" cy="20%" r="60%"><stop offset="0" stop-color="#D4B45A" stop-opacity=".32"/><stop offset="1" stop-color="#0B3E78" stop-opacity="0"/></radialGradient></defs>
      <rect width="800" height="460" fill="url(#g1)"/>
      <g fill="none" stroke="#D4B45A" stroke-opacity=".25"><circle cx="620" cy="160" r="120"/><circle cx="620" cy="160" r="180"/><circle cx="620" cy="160" r="240"/></g>
      <g font-family="IBM Plex Sans, sans-serif">
        <rect x="80" y="110" width="300" height="118" rx="16" fill="#0F4A8C" stroke="#3A6FAE"/><text x="104" y="146" fill="#D4B45A" font-size="13">SLA compliance this week</text><text x="104" y="196" fill="#fff" font-size="36" font-weight="600">96.4%</text><text x="206" y="196" fill="#7CE0A6" font-size="14">▲ 2.1</text>
        <rect x="400" y="300" width="300" height="118" rx="16" fill="#0F4A8C" stroke="#3A6FAE"/><text x="424" y="336" fill="#D4B45A" font-size="13">Bookings, month to date</text><text x="424" y="386" fill="#fff" font-size="36" font-weight="600">₹18.4 L</text><text x="606" y="386" fill="#FFD38A" font-size="14">of ₹25 L</text>
        <rect x="80" y="300" width="300" height="118" rx="16" fill="#0F4A8C" stroke="#3A6FAE"/><text x="104" y="336" fill="#D4B45A" font-size="13">On-time dispatch</text><text x="104" y="386" fill="#fff" font-size="36" font-weight="600">91%</text><polyline points="230,392 250,380 270,386 290,368 310,372 330,356 350,360" fill="none" stroke="#7CE0A6" stroke-width="3" stroke-linecap="round"/>
        <rect x="400" y="110" width="300" height="118" rx="16" fill="#0F4A8C" stroke="#3A6FAE"/><text x="424" y="146" fill="#D4B45A" font-size="13">SOPs done on time today</text><text x="424" y="196" fill="#fff" font-size="36" font-weight="600">41 / 44</text>
      </g>
    </svg>
    <div style="position:relative;max-width:520px">
      <div style="margin-bottom:26px">${brand({ onDark: true, tagline: true, width: 84, style: 'padding:0;color:#fff;pointer-events:none' })}</div>
      <h2 style="font-size:34px;line-height:1.15;font-weight:600;margin-bottom:14px">One page that tells you how the company is doing. Today.</h2>
      <p style="color:#B8B8B8;font-size:15px;line-height:1.6">Tickets, deals, work orders, SOPs and KPIs for every team at Loyal String, with the same numbers for the CEO, the COO and every manager.</p>
    </div>
  </section>`;
}

export function loginPage(o: { csrf: string; error?: string; email?: string; next?: string; info?: string }): Raw {
  return publicPage({ title: 'Sign in', body: html`<div class="login">
    <section class="login-form">
      <div class="row between">${brand({ onDark: false, href: '/', style: 'padding:0' })}<span class="small muted">Loyal String · workforce platform</span></div>
      <form class="login-box form" method="post" action="/login" autocomplete="on">
        <div><h1 style="font-size:28px">Welcome back</h1><p class="muted" style="margin-top:6px">Sign in with your work email.</p></div>
        ${when(o.error, () => notice('crit', o.error!))}
        ${when(o.info, () => notice('good', o.info!))}
        <input type="hidden" name="_csrf" value="${o.csrf}"><input type="hidden" name="next" value="${o.next || ''}">
        ${field('Work email', input('email', { type: 'email', value: o.email || '', placeholder: 'name@loyalstring.com', required: true, autocomplete: 'username' }))}
        ${field(html`<span class="row between" style="width:100%">Password <a class="small" href="/forgot-password" style="font-weight:500">Forgot password?</a></span>`, input('password', { type: 'password', required: true, autocomplete: 'current-password', placeholder: '••••••••••' }))}
        <button class="btn btn-primary btn-lg" type="submit" style="width:100%">Sign in ${icon('arrow', 18)}</button>
        <p class="small muted" style="text-align:center">Sessions last 14 days on this device. Five wrong attempts lock the account for 15 minutes.</p>
      </form>
      <p class="xs faint">© Loyal String Technologies · Loyal Flow · Vision 2030</p>
    </section>
    ${brandPanel()}
  </div>` });
}

export function forgotPage(o: { csrf: string; sent?: boolean; demoLink?: string | null }): Raw {
  return publicPage({ title: 'Reset password', body: html`<div class="login"><section class="login-form">
    ${brand({ onDark: false, href: '/login', style: 'padding:0' })}
    <form class="login-box form" method="post" action="/forgot-password">
      <div><h1 style="font-size:26px">Reset your password</h1><p class="muted" style="margin-top:6px">We will email a link that works for 60 minutes.</p></div>
      ${when(o.sent, () => notice('good', html`If that address belongs to an employee, the reset link is on its way.${when(o.demoLink, () => html`<br><span class="small">Demo mode, no mail server: <a href="${o.demoLink}">open the reset link</a>.</span>`)}`))}
      <input type="hidden" name="_csrf" value="${o.csrf}">
      ${field('Work email', input('email', { type: 'email', required: true, placeholder: 'name@loyalstring.com', autocomplete: 'username' }))}
      <button class="btn btn-primary btn-lg" type="submit" style="width:100%">Send reset link</button>
      <a class="small" href="/login" style="text-align:center">Back to sign in</a>
    </form><span></span></section>${brandPanel()}</div>` });
}

export function resetPage(o: { csrf: string; token: string; error?: string }): Raw {
  return publicPage({ title: 'Choose a new password', body: html`<div class="login"><section class="login-form">
    ${brand({ onDark: false, href: '/login', style: 'padding:0' })}
    <form class="login-box form" method="post" action="/reset-password">
      <div><h1 style="font-size:26px">Choose a new password</h1><p class="muted" style="margin-top:6px">At least 10 characters with a letter and a number.</p></div>
      ${when(o.error, () => notice('crit', o.error!))}
      <input type="hidden" name="_csrf" value="${o.csrf}"><input type="hidden" name="token" value="${o.token}">
      ${field('New password', input('password', { type: 'password', required: true, autocomplete: 'new-password' }))}
      ${field('Repeat it', input('password2', { type: 'password', required: true, autocomplete: 'new-password' }))}
      <button class="btn btn-primary btn-lg" type="submit" style="width:100%">Save password</button>
    </form><span></span></section>${brandPanel()}</div>` });
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
