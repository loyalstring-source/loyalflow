import { atLeast, type ModuleKey } from '../lib/roles.ts';
import { reportsFor, MENU_OF } from '../modules/reports/engine.ts';
import { html, raw, when, jsonScript, type Raw, type HtmlValue } from '../lib/html.ts';
import type { App } from '../app.ts';
import type { Employee } from '../modules/people/model.ts';
import { can, hrRestricted, type Action } from '../lib/scope.ts';
import { icon, avatar, brand } from './components.ts';
import { fmtDateFull } from '../lib/time.ts';

/** Per-request view context handed to every page renderer. */
export interface View {
  app: App;
  user: Employee;
  csrf: string;
  lang: 'en' | 'hi';
  path: string;
  unread: number;
  approvalsPending: number;
  deptCode: string;
  isManager: boolean;
}

export interface NavItem { key: string; label: string; href: string; icon: string; need?: Action; badge?: number; mobile?: boolean }

export function navFor(v: View): NavItem[] {
  const db = v.app.db, u = v.user;
  const items: NavItem[] = [
    { key: 'today', label: 'Today', href: '/', icon: 'sun', mobile: true },
    { key: 'company', label: 'Company', href: '/company', icon: 'grid' },
    { key: 'analytics', label: 'Analytics', href: '/analytics', icon: 'chart' },
    { key: 'desk', label: 'Service desk', href: '/desk', icon: 'ticket' },
    { key: 'dev', label: 'Development', href: '/dev', icon: 'code' },
    { key: 'pipeline', label: 'Pipeline', href: '/pipeline', icon: 'funnel' },
    { key: 'production', label: 'Production', href: '/production', icon: 'factory' },
    { key: 'procurement', label: 'Procurement', href: '/procurement', icon: 'truck' },
    { key: 'sops', label: 'SOPs', href: '/sops', icon: 'checklist', mobile: true },
    { key: 'approvals', label: 'Approvals', href: '/approvals', icon: 'approval', badge: v.approvalsPending, mobile: true },
    { key: 'tasks', label: 'Tasks', href: '/tasks', icon: 'check' },
    { key: 'people', label: 'People', href: '/people', icon: 'people', mobile: true },
    { key: 'attendance', label: 'Attendance', href: '/attendance', icon: 'calendar' },
    { key: 'appraisals', label: 'Appraisals', href: '/appraisals', icon: 'star' },
    { key: 'hire', label: 'Hiring', href: '/hire', icon: 'user' },
    { key: 'payroll', label: 'Payroll', href: '/payroll', icon: 'rupee' },
    { key: 'budgets', label: 'Budgets', href: '/budgets', icon: 'rupee' },
    { key: 'settings', label: 'Settings', href: '/settings', icon: 'settings' }
  ];
  const primary = v.deptCode === 'SAL' || v.deptCode === 'PRE' ? 'pipeline' : v.deptCode === 'PRD' ? 'production' : v.deptCode === 'DEV' || v.deptCode === 'QA' ? 'dev' : 'desk';
  // The menu follows the person's role: a module is listed when the role gives at least "View" in it (Settings → Roles and permissions).
  const moduleOf: Record<string, ModuleKey> = { company: 'company', analytics: 'analytics', desk: 'desk', dev: 'dev', pipeline: 'sales', production: 'production', procurement: 'procurement', sops: 'sops', tasks: 'tasks', people: 'people', attendance: 'attendance', appraisals: 'appraisals', hire: 'hire', payroll: 'payroll', budgets: 'budgets', settings: 'settings' };
  return items.filter((i) => !moduleOf[i.key] || atLeast(db, u, moduleOf[i.key], 'view')).map((i) => i.key === primary ? { ...i, mobile: true } : i);
}

export function activeKey(path: string): string {
  if (path === '/' || path.startsWith('/today') || path.startsWith('/my-day')) return 'today';
  const seg = path.split('/')[1] || '';
  const map: Record<string, string> = { attendance: 'attendance', appraisals: 'appraisals', hire: 'hire', payroll: 'payroll', procurement: 'procurement', budgets: 'budgets', imports: 'settings', hours: 'analytics', company: 'company', kpi: 'company', analytics: 'analytics', desk: 'desk', tickets: 'desk', customers: 'pipeline', dev: 'dev', pipeline: 'pipeline', deals: 'pipeline', estimates: 'pipeline', products: 'pipeline', production: 'production', 'work-orders': 'production', sops: 'sops', 'sop-runs': 'sops', approvals: 'approvals', tasks: 'tasks', people: 'people', settings: 'settings', lists: 'settings', roles: 'settings', reports: 'company', me: 'people', notifications: 'today' };
  return map[seg] || seg;
}

export interface PageOpts {
  title: string;
  subtitle?: HtmlValue;
  actions?: HtmlValue;
  body: HtmlValue;
  wide?: boolean;
  noSearch?: boolean;
  headExtra?: HtmlValue;
  docTitle?: string;
  /** The tab to mark as active when the address alone does not say (reports). */
  navTab?: string;
  /** Reload the page every N seconds while nothing is open or focused (boards). */
  autoRefresh?: number;
}

const HEAD = (title: string) => html`<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>${title}</title>
<meta name="theme-color" content="#FFFFFF"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/static/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/static/icon-192.png">
<link rel="stylesheet" href="/static/app.css?v=${ASSET_V}"><link rel="stylesheet" href="/static/motion.css?v=${ASSET_V}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600&family=Inter:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/static/theme.css?v=${ASSET_V}">`;

export const ASSET_V = '36';

/** The modules of the app, each with its own tabs. A person sees a module when their role lets them into at least one of its tabs. */
interface ModuleDef { key: string; name: string; icon: string; tone: string; tabs: string[] }
const MODULES: ModuleDef[] = [
  { key: 'home', name: 'Home', icon: 'home', tone: 'blue', tabs: ['overview', 'today', 'dsr', 'approvals', 'tasks', 'money', 'notifications'] },
  { key: 'sales', name: 'Sales', icon: 'star', tone: 'orange', tabs: ['pipeline', 'estimates', 'products', 'customers', 'reports:sales'] },
  { key: 'support', name: 'Support', icon: 'ticket', tone: 'blue', tabs: ['desk', 'reports:support'] },
  { key: 'dev', name: 'Development', icon: 'code', tone: 'violet', tabs: ['dev', 'reports:dev'] },
  { key: 'production', name: 'Production', icon: 'factory', tone: 'grey', tabs: ['production', 'procurement', 'reports:production'] },
  { key: 'people', name: 'People', icon: 'people', tone: 'green', tabs: ['people', 'attendance', 'appraisals', 'hire', 'payroll', 'reports:people'] },
  { key: 'company', name: 'Company', icon: 'chart', tone: 'navy', tabs: ['company', 'analytics', 'budgets', 'sops', 'reports:company'] },
  { key: 'admin', name: 'Settings', icon: 'settings', tone: 'grey', tabs: ['settings', 'targets', 'admins', 'lists', 'roles', 'reports:admin'] }
];
export interface ModuleNav { key: string; name: string; icon: string; tone: string; tabs: NavItem[] }
/** The modules and tabs this person can open, in menu order. */
export function modulesFor(v: View): ModuleNav[] {
  const nav = navFor(v); const byKey = new Map(nav.map((n) => [n.key, n]));
  // Tabs that live under a menu entry and follow its access.
  if (byKey.has('pipeline')) { byKey.set('estimates', { key: 'estimates', label: 'Estimates', href: '/estimates', icon: 'file' }); byKey.set('products', { key: 'products', label: 'Products', href: '/products', icon: 'grid' }); byKey.set('customers', { key: 'customers', label: 'Customers', href: '/customers', icon: 'people' }); }
  if (byKey.has('settings')) { byKey.set('lists', { key: 'lists', label: 'Lists and options', href: '/lists', icon: 'checklist' }); byKey.set('roles', { key: 'roles', label: 'Roles', href: '/roles', icon: 'user' }); }
  // A Reports tab in each module that has reports this person may run.
  const mine = reportsFor(v.app, v.user); const menus = new Set(mine.map((r) => MENU_OF[r.module]));
  for (const m of menus) byKey.set(`reports:${m}`, { key: `reports:${m}`, label: m === 'admin' ? 'Change history' : 'Reports', href: m === 'company' ? '/reports' : m === 'admin' ? '/reports/admin-audit' : `/reports?module=${m}`, icon: 'chart' });
  if (byKey.has('tasks')) byKey.set('dsr', { key: 'dsr', label: 'Daily review', href: '/dsr', icon: 'checklist' });
  // The overview: the whole company for executives and administrators, their own teams for team managers.
  const companyLevel = !!v.user.is_admin || v.user.functional_role === 'executive';
  const leads = companyLevel || v.user.functional_role === 'hod' || v.user.functional_role === 'team_lead' || !!v.app.db.get('SELECT 1 AS x FROM departments WHERE hod_id = ?', [v.user.id]);
  if (leads) byKey.set('overview', { key: 'overview', label: companyLevel ? 'Company overview' : 'Team overview', href: companyLevel ? '/' : '/overview', icon: 'chart' });
  if (companyLevel && byKey.has('today')) byKey.set('today', { ...byKey.get('today')!, href: '/my-day' });
  if (leads || v.app.db.get('SELECT 1 AS x FROM target_setters WHERE employee_id = ?', [v.user.id])) byKey.set('targets', { key: 'targets', label: 'Targets', href: '/targets', icon: 'target' });
  if (companyLevel) byKey.set('admins', { key: 'admins', label: 'Administrators', href: '/admins', icon: 'user' });
  byKey.set('money', { key: 'money', label: 'Expenses', href: '/money', icon: 'rupee' });
  byKey.set('notifications', { key: 'notifications', label: 'Notifications', href: '/notifications', icon: 'bell', badge: v.unread });
  const rename: Record<string, string> = { today: companyLevel ? 'My day' : 'Today', pipeline: 'Deals', desk: 'Tickets', dev: 'Board', production: 'Work orders', people: 'Directory', company: 'Dashboard', settings: 'General' };
  return MODULES.map((m) => ({ key: m.key, name: m.name, icon: m.icon, tone: m.tone, tabs: m.tabs.map((k) => byKey.get(k)).filter((x): x is NavItem => !!x).map((t) => ({ ...t, label: rename[t.key] || t.label })) })).filter((m) => m.tabs.length);
}
/** The order of the menu cards and the pinned pages, as the person left them. */
export function menuPrefs(v: View): { order: string[]; pins: string[] } {
  try { const row = v.app.db.get<{ value: string }>("SELECT value FROM user_prefs WHERE employee_id = ? AND key = 'menu'", [v.user.id]); const p = row ? JSON.parse(row.value) as { order?: unknown; pins?: unknown } : {};
    const list = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').slice(0, 40) : []); return { order: list(p.order), pins: list(p.pins) }; } catch { return { order: [], pins: [] }; }
}
/** Which tab a page belongs to. */
export function tabKey(path: string): string {
  const seg = path.split('/')[1] || '';
  if (['estimates', 'products', 'customers', 'lists', 'roles', 'notifications', 'dsr', 'overview', 'targets', 'admins', 'money'].includes(seg)) return seg;
  return activeKey(path);
}

export function page(v: View, o: PageOpts): Raw {
  const nav = navFor(v);
  const active = activeKey(v.path); const tab = o.navTab || tabKey(v.path);
  const modules = modulesFor(v);
  const current = modules.find((m) => m.tabs.some((t) => t.key === tab)) || modules.find((m) => m.tabs.some((t) => t.key === active)) || null;
  const mobile = nav.filter((n) => n.mobile).slice(0, 5);
  // Each person's own order for the menu cards, and the pages they pinned.
  const pref = menuPrefs(v); const pins = pref.pins;
  const ordered = [...modules].sort((a, b) => { const i = pref.order.indexOf(a.key), j = pref.order.indexOf(b.key); return (i < 0 ? 999 : i) - (j < 0 ? 999 : j); });
  const pinned = pins.map((k) => { for (const m of modules) { const t = m.tabs.find((x) => x.key === k); if (t) return { ...t, tone: m.tone }; } return null; }).filter((x): x is NavItem & { tone: string } => !!x);
  const cfg = { user: { id: v.user.id, name: v.user.full_name, lang: v.lang, dept: v.deptCode }, csrf: v.csrf };
  return html`<!doctype html><html lang="${v.lang}"><head>${HEAD(`${o.docTitle || o.title} · LoyalFlow`)}${o.headExtra}</head>
<body data-path="${v.path}"${when(o.autoRefresh, () => html` data-autorefresh="${o.autoRefresh}"`)}>
<div class="app">
  <header class="shellbar">
    <div class="shellbar-top">
      ${brand({ onDark: false, href: '/', width: 50 })}
      ${when(!o.noSearch, () => html`<form class="search" action="/search" method="get" role="search">${icon('search', 16)}<input type="search" name="q" id="global-search" placeholder="Search people, deals, tickets, orders" aria-label="Search"><kbd>/</kbd></form>`)}
      <div class="shellbar-tools">
        <a class="shellbar-icon" href="/notifications" aria-label="Notifications${v.unread ? `, ${v.unread} new` : ''}">${icon('bell', 20)}${when(v.unread, () => html`<span class="badge">${v.unread}</span>`)}</a>
        <a class="shellbar-user" href="/me">${avatar(v.user.full_name, v.user.id)}<span class="shellbar-user-name"><b>${v.user.full_name}</b><span class="xs muted">${v.user.designation}</span></span></a>
      </div>
    </div>
    <nav class="shellbar-nav" aria-label="Main">
      <details class="launcher">
        <summary aria-label="All pages" title="All pages">${icon('grid', 20)}</summary>
        <div class="launcher-menu" role="dialog" aria-label="All pages" data-launcher>
          <div class="lm-top"><label class="lm-search">${icon('search', 16)}<input type="search" placeholder="Find a page, for example Payroll" aria-label="Find a page" data-lm-search autocomplete="off"></label>
            <span class="lm-hint small muted">${icon('grip', 14)} Drag a card by its handle to rearrange. Your order is remembered.</span><button class="btn btn-sm" type="button" data-lm-reset>Reset order</button><button class="btn btn-ghost btn-sm" type="button" data-lm-close aria-label="Close">${icon('x', 16)}</button></div>
          <div class="lm-pins" data-lm-pins><span class="small muted lm-pins-label">${icon('star', 14)} Pinned</span>${pinned.map((t) => html`<a class="lm-pin" href="${t.href}" data-pin="${t.key}"><span class="lm-ico sq-${t.tone}">${icon(t.icon, 13)}</span>${t.label}</a>`)}<span class="small muted" data-lm-pinhint ${when(pinned.length, 'hidden')}>Press the star beside any page to keep it here.</span></div>
          <div class="lm-grid" data-lm-grid>${ordered.map((m) => html`<section class="lm-card" data-mod="${m.key}">
            <div class="lm-head lm-${m.tone}"><a class="lm-title" href="${m.tabs[0].href}"><span class="sq sq-${m.tone}">${icon(m.icon, 18)}</span><b>${m.name}</b></a><span class="lm-move"><button type="button" data-lm-up aria-label="Move ${m.name} earlier" title="Move earlier">${icon('arrow', 14)}</button><button type="button" data-lm-down aria-label="Move ${m.name} later" title="Move later">${icon('arrow', 14)}</button></span><span class="lm-grip" draggable="true" title="Drag to move" aria-hidden="true">${icon('grip', 18)}</span></div>
            <div class="lm-links">${m.tabs.map((t) => html`<div class="lm-row" data-key="${t.key}" data-label="${t.label} ${m.name}"><a class="lm-link ${t.key === tab ? 'on' : ''}" href="${t.href}"><span class="lm-ico lm-${m.tone}">${icon(t.icon, 15)}</span><span class="lm-label">${t.label}</span>${when(t.badge, () => html`<span class="lm-count">${t.badge}</span>`)}</a><button class="lm-star ${pins.includes(t.key) ? 'on' : ''}" type="button" data-lm-star data-tone="${m.tone}" data-icon-html aria-pressed="${pins.includes(t.key) ? 'true' : 'false'}" aria-label="Pin ${t.label}" title="Pin to the top">${icon('star', 14)}</button></div>`)}</div></section>`)}</div>
          <p class="small muted lm-none" data-lm-none hidden>No page matches that.</p>
        </div>
      </details>
      <span class="shellbar-module">${current ? current.name : 'Loyal Flow'}</span>
      <div class="shellbar-tabs">${(current ? current.tabs : []).map((t) => html`<a href="${t.href}" class="${t.key === tab || (t.key === active && !current!.tabs.some((x) => x.key === tab)) ? 'active' : ''}">${t.label}${when(t.badge, () => html`<span class="badge">${t.badge}</span>`)}</a>`)}</div>
    </nav>
  </header>
  <div class="main">
    <main class="content ${o.wide ? 'content-wide' : ''}">
      <section class="card page-head">
        <div class="page-head-id">${when(current, () => html`<span class="sq sq-${current!.tone}">${icon(current!.icon, 20)}</span>`)}<div class="title"><h1>${o.title}</h1>${when(o.subtitle, () => html`<div class="sub">${o.subtitle}</div>`)}</div></div>
        ${when(o.actions, () => html`<div class="row page-head-actions">${o.actions}</div>`)}
      </section>
      ${o.body}
    </main>
    <nav class="mobile-nav" aria-label="Mobile">${mobile.map((n) => html`<a href="${n.href}" class="${n.key === active ? 'active' : ''}">${icon(n.icon)}<span>${n.label}</span>${when(n.badge, () => html`<span class="badge" style="position:absolute;margin-left:28px;margin-top:-2px">${n.badge}</span>`)}</a>`)}</nav>
  </div>
</div>
<div class="drawer-root" id="drawer-root" aria-hidden="true"><button class="drawer-scrim" data-close-drawer aria-label="Close panel"></button><div class="drawer" id="drawer" role="dialog"></div></div>
<div class="modal-root" id="modal-root" aria-hidden="true"><div class="modal" id="modal" role="dialog"></div></div>
<div id="toast-root"></div>
<script id="lf-config" type="application/json">${jsonScript(cfg)}</script>
<script src="/static/app.js?v=${ASSET_V}" defer></script>
</body></html>`;
}

/** Shell for signed-out pages (login, reset, rating). */
export function publicPage(o: { title: string; body: HtmlValue; narrow?: boolean }): Raw {
  return html`<!doctype html><html lang="en"><head>${HEAD(`${o.title} · LoyalFlow`)}</head>
<body style="background:var(--ground)">${o.body}<div id="toast-root"></div><script id="lf-config" type="application/json">${jsonScript({ user: null, csrf: '' })}</script><script src="/static/app.js?v=${ASSET_V}" defer></script></body></html>`;
}

/** A drawer/modal partial: the HTML fragment that app.js injects into the side panel. */
export function drawer(o: { title: HtmlValue; meta?: HtmlValue; body: HtmlValue; foot?: HtmlValue; href?: string }): Raw {
  return html`<div class="drawer-head">
    <div class="row between"><div class="row" style="gap:8px;min-width:0;flex:1">${when(o.href, () => html`<a class="pill pill-ink" href="${o.href}" style="text-decoration:none">${icon('arrow', 12)} Open page</a>`)}</div><button class="btn btn-ghost btn-icon" data-close-drawer aria-label="Close">${icon('x', 18)}</button></div>
    <h2 style="font-size:18px">${o.title}</h2>${when(o.meta, () => html`<div class="row small muted">${o.meta}</div>`)}
  </div>
  <div class="drawer-body">${o.body}</div>
  ${when(o.foot, () => html`<div class="drawer-foot">${o.foot}</div>`)}`;
}

export function modal(o: { title: HtmlValue; body: HtmlValue }): Raw {
  return html`<div class="row between"><h2 style="font-size:18px">${o.title}</h2><button class="btn btn-ghost btn-icon" data-close-modal aria-label="Close">${icon('x', 18)}</button></div>${o.body}`;
}

export function greeting(now: Date, name: string): string {
  const h = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) / 60 % 24;
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${name}`;
}

export function todayLine(now: Date): string { return fmtDateFull(now); }

export function csrfField(v: View): Raw { return html`<input type="hidden" name="_csrf" value="${v.csrf}">`; }

export function errorPage(status: number, message: string, v?: View): Raw {
  const body = html`<div class="card" style="max-width:560px;margin:40px auto;text-align:center;display:flex;flex-direction:column;gap:12px;align-items:center">
    <span style="font-size:40px">${status === 404 ? '🧭' : status === 403 ? '🔒' : '🛠️'}</span>
    <h2>${status === 404 ? 'That page does not exist' : status === 403 ? 'Not allowed' : 'Something went wrong'}</h2>
    <p class="muted">${message}</p>
    <a class="btn btn-primary" href="/">Back to Today</a>
  </div>`;
  return v ? page(v, { title: status === 404 ? 'Not found' : status === 403 ? 'Not allowed' : 'Error', body, noSearch: true }) : publicPage({ title: 'Error', body });
}

export { raw };
