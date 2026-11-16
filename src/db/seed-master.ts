// Master data: departments, sites, the employee master (44 rows, corrected on 2 Nov 2026) and starter SOPs.
// Emails are generated as first.last@<EMAIL_DOMAIN> and must be replaced with the real Microsoft 365 addresses by HR.
import type { App } from '../app.ts';
import { hashPassword } from '../lib/crypto.ts';
import { DEFAULT_SETTINGS, setSetting } from '../lib/settings.ts';
import type { FunctionalRole } from '../modules/people/model.ts';

export const SITES = [
  { id: 'HO', name: 'Head office', city: 'Pune' },
  { id: 'MFG', name: 'Manufacturing unit', city: 'Pune' }
];

export const DEPARTMENTS = [
  { id: 'LEAD', name: 'Leadership', code: 'LEAD', hod_id: 'LS001', shift_code: 'GEN', band: 'people' },
  { id: 'HR', name: 'HR', code: 'HR', hod_id: 'LS002', shift_code: 'GEN', band: 'people' },
  { id: 'DM', name: 'Design & Marketing', code: 'DM', hod_id: 'LS002', shift_code: 'GEN', band: 'revenue' },
  { id: 'ACC', name: 'Accounts & Finance', code: 'ACC', hod_id: 'LS002', shift_code: 'GEN', band: 'people' },
  { id: 'DEV', name: 'Software Development', code: 'DEV', hod_id: 'LS007', shift_code: 'DEV', band: 'service' },
  { id: 'QA', name: 'QA', code: 'QA', hod_id: 'LS007', shift_code: 'DEV', band: 'service' },
  { id: 'SUP', name: 'Technical Support', code: 'SUP', hod_id: 'LS002', shift_code: 'SUP', band: 'service' },
  { id: 'SAL', name: 'Sales', code: 'SAL', hod_id: 'LS028', shift_code: 'SAL', band: 'revenue' },
  { id: 'PRE', name: 'Pre-sales', code: 'PRE', hod_id: 'LS002', shift_code: 'SAL', band: 'revenue' },
  { id: 'PRD', name: 'Production', code: 'PRD', hod_id: 'LS006', shift_code: 'PRD', band: 'operations' }
];

type Row = [id: string, name: string, designation: string, dept: string, subTeam: string, site: string, role: FunctionalRole, manager: string | null, shift: string];

export const EMPLOYEES: Row[] = [
  ['LS001', 'Rahul Thakare', 'Chief Executive Officer', 'LEAD', '', 'HO', 'executive', null, 'GEN'],
  ['LS002', 'Sridhar Narayanagowda', 'Chief Operating Officer', 'LEAD', '', 'HO', 'executive', 'LS001', 'GEN'],
  ['LS003', 'Amruta Junnarkar', 'Senior HR Specialist', 'HR', '', 'HO', 'ic', 'LS002', 'GEN'],
  ['LS004', 'Tirupati Jadhav', 'Digital Marketing Executive', 'DM', '', 'HO', 'ic', 'LS002', 'GEN'],
  ['LS005', 'Rahul Pund', 'Graphics Designer', 'DM', '', 'HO', 'ic', 'LS002', 'GEN'],
  ['LS006', 'Mahesh Mapari', 'Head, Accounts & Finance and Production', 'ACC', '', 'HO', 'hod', 'LS002', 'GEN'],
  ['LS007', 'Karan Pramod Bhoite', 'Sr. Software Engineer (React/Next JS)', 'DEV', 'React', 'HO', 'hod', 'LS002', 'DEV'],
  ['LS008', 'Shubham Ananda Patil', 'Lead Software Engineer', 'DEV', '', 'HO', 'ic', 'LS007', 'DEV'],
  ['LS009', 'Shubham Nandkishor Bherde', 'Sr. Software Engineer (Dot Net)', 'DEV', '.NET', 'HO', 'team_lead', 'LS007', 'DEV'],
  ['LS010', 'Akash Panbhare', 'Software Engineer', 'DEV', '.NET', 'HO', 'ic', 'LS009', 'DEV'],
  ['LS011', 'Pratik Shashikant Sawant', 'Jr Software Engineer', 'DEV', '.NET', 'HO', 'ic', 'LS009', 'DEV'],
  ['LS012', 'Saurabh Duva', 'Dot Net Developer', 'DEV', '.NET', 'HO', 'ic', 'LS009', 'DEV'],
  ['LS013', 'Anant Sahu', 'Full Stack Developer', 'DEV', '', 'HO', 'ic', 'LS007', 'DEV'],
  ['LS014', 'Mahesh Prakashrao Ambhore', 'Sr. Software Engineer (React/Next JS)', 'DEV', 'React', 'HO', 'ic', 'LS007', 'DEV'],
  ['LS015', 'Santosh Paragondappa Managuli', 'Sr. Software Engineer (Full Stack)', 'DEV', '', 'HO', 'ic', 'LS007', 'DEV'],
  ['LS016', 'Sourabh Pal', 'Sr. Mobile App Developer', 'DEV', 'Mobile', 'HO', 'ic', 'LS007', 'DEV'],
  ['LS017', 'Vasanti Suryakant Karadage', 'Sr. Software Engineer (Android)', 'DEV', 'Mobile', 'HO', 'ic', 'LS007', 'DEV'],
  ['LS018', 'Mayur Avhad', 'Quality Assurance', 'QA', '', 'HO', 'ic', 'LS007', 'DEV'],
  ['LS019', 'Saurabh Shankarrao Yadav', 'Sr. Quality Assurance', 'QA', '', 'HO', 'ic', 'LS007', 'DEV'],
  ['LS020', 'Prasad Kishanrao Panchal', 'Technical Support Engineer', 'SUP', '', 'HO', 'team_lead', 'LS002', 'SUP'],
  ['LS021', 'Aditya Verma', 'Technical Support Engineer', 'SUP', '', 'HO', 'ic', 'LS020', 'SUP'],
  ['LS022', 'Ayush Kumar Chaturvedi', 'Technical Support Engineer', 'SUP', '', 'HO', 'ic', 'LS020', 'SUP'],
  ['LS023', 'Chandu V', 'Technical Support', 'SUP', '', 'HO', 'ic', 'LS020', 'SUP'],
  ['LS024', 'Nikita Ravan Kakade', 'Jr Technical Support Executive', 'SUP', '', 'HO', 'ic', 'LS020', 'SUP'],
  ['LS025', 'Deepika Patel', 'Jr Technical Support Executive', 'SUP', '', 'HO', 'ic', 'LS020', 'SUP'],
  ['LS026', 'Madhuri Shinde', 'Jr Technical Support Executive', 'SUP', '', 'HO', 'ic', 'LS020', 'SUP'],
  ['LS027', 'Nagesh Bansode', 'Jr Technical Support Executive', 'SUP', '', 'HO', 'ic', 'LS020', 'SUP'],
  ['LS028', 'Muruganandam K', 'Business Development Manager (Sales Head)', 'SAL', 'Domestic', 'HO', 'hod', 'LS001', 'SAL'],
  ['LS029', 'Alpesh Boda', 'Business Development Manager', 'SAL', 'Domestic', 'HO', 'ic', 'LS028', 'SAL'],
  ['LS030', 'Ashish Pathak', 'Business Development Manager', 'SAL', 'Domestic', 'HO', 'ic', 'LS028', 'SAL'],
  ['LS031', 'Gogula Rama Narasimha Murthy Vamsi', 'Business Development Manager', 'SAL', 'Domestic', 'HO', 'ic', 'LS028', 'SAL'],
  ['LS032', 'Hari Prasad', 'Business Development Manager', 'SAL', 'Domestic', 'HO', 'ic', 'LS028', 'SAL'],
  ['LS033', 'Sandesh Padmakar Potdar', 'Business Development Manager', 'SAL', 'Domestic', 'HO', 'ic', 'LS028', 'SAL'],
  ['LS034', 'Sanpreet Singh', 'Business Development Manager', 'SAL', 'Domestic', 'HO', 'ic', 'LS028', 'SAL'],
  ['LS035', 'Utkarsh Pathak', 'Business Development Manager', 'SAL', 'Domestic', 'HO', 'ic', 'LS028', 'SAL'],
  ['LS036', 'Prateek Sharma', 'International Business Development Manager', 'SAL', 'International', 'HO', 'ic', 'LS001', 'SAL'],
  ['LS037', 'Madhuri Vichare', 'Sales Executive (Pre-sales)', 'PRE', '', 'HO', 'ic', 'LS002', 'SAL'],
  ['LS038', 'Rudrat Kumar Dey', 'Marketing Operations and Internal Sales Analysis', 'PRE', '', 'HO', 'ic', 'LS002', 'SAL'],
  ['LS039', 'Lukman Nishad', 'Dispatch Admin', 'PRD', '', 'MFG', 'team_lead', 'LS006', 'PRD'],
  ['LS040', 'Amar Aher', 'Junior Engineer - Mechanical', 'PRD', '', 'MFG', 'ic', 'LS039', 'PRD'],
  ['LS041', 'Antaryami Kaivarta', 'Dispatch Assistant', 'PRD', '', 'MFG', 'ic', 'LS039', 'PRD'],
  ['LS042', 'Dhaneshwari Nishad', 'Production Helper', 'PRD', '', 'MFG', 'ic', 'LS039', 'PRD'],
  ['LS043', 'Dushyant Nishad', 'Production Assistant', 'PRD', '', 'MFG', 'ic', 'LS039', 'PRD'],
  ['LS044', 'Pranjal Chaturvedi', 'Production Helper (Computer Operator)', 'PRD', '', 'MFG', 'ic', 'LS039', 'PRD']
];

export function emailFor(name: string, domain: string): string {
  const parts = name.toLowerCase().normalize('NFKD').replace(/[^a-z\s]/g, '').trim().split(/\s+/);
  const local = parts.length > 1 ? `${parts[0]}.${parts[parts.length - 1]}` : parts[0];
  return `${local}@${domain}`;
}

export interface SopStep { key: string; title: string; evidence: 'none' | 'note' | 'call' | 'file' | 'record'; dueOffsetMin: number }

export const SOPS: { id: string; name: string; department_id: string; owner_role: string; trigger: string; trigger_detail: string; steps: SopStep[] }[] = [
  { id: 'SOP-SUP-HUDDLE', name: 'Daily support huddle', department_id: 'SUP', owner_role: 'team_lead', trigger: 'daily', trigger_detail: '', steps: [
    { key: 'review', title: 'Review overnight tickets and anything under 1 hour on the clock', evidence: 'none', dueOffsetMin: 30 },
    { key: 'assign', title: 'Assign every unowned ticket before 10:30', evidence: 'record', dueOffsetMin: 30 },
    { key: 'p1calls', title: 'Call back every P1 customer with a status update', evidence: 'call', dueOffsetMin: 180 },
    { key: 'backlog', title: 'Review tickets older than 7 days with their owner', evidence: 'note', dueOffsetMin: 420 },
    { key: 'roster', title: "Confirm tomorrow's shift roster, including UK-hours cover", evidence: 'none', dueOffsetMin: 510 }
  ] },
  { id: 'SOP-SAL-MONDAY', name: 'Monday pipeline review', department_id: 'SAL', owner_role: 'hod', trigger: 'weekly', trigger_detail: '1', steps: [
    { key: 'nextsteps', title: 'Every open deal has a next step with a date', evidence: 'record', dueOffsetMin: 120 },
    { key: 'stale', title: 'Deals in a stage longer than 7 days reviewed with the BDM', evidence: 'note', dueOffsetMin: 180 },
    { key: 'targets', title: 'This week\'s targets confirmed per BDM and pre-sales', evidence: 'record', dueOffsetMin: 180 },
    { key: 'lost', title: 'Lost reasons of last week reviewed', evidence: 'note', dueOffsetMin: 240 }
  ] },
  { id: 'SOP-PRD-DISPATCH', name: 'Dispatch checklist', department_id: 'PRD', owner_role: 'team_lead', trigger: 'daily', trigger_detail: '', steps: [
    { key: 'plan', title: 'Today\'s dispatch plan confirmed against promised dates', evidence: 'none', dueOffsetMin: 60 },
    { key: 'invoice', title: 'Invoice reference entered on every order before dispatch', evidence: 'record', dueOffsetMin: 480 },
    { key: 'photo', title: 'Photo of packed goods attached on every dispatch', evidence: 'file', dueOffsetMin: 480 },
    { key: 'notify', title: 'Customer sent the consignment number', evidence: 'record', dueOffsetMin: 480 }
  ] },
  { id: 'SOP-ACC-CLOSE', name: 'Month-end close', department_id: 'ACC', owner_role: 'hod', trigger: 'monthly', trigger_detail: '1', steps: [
    { key: 'bank', title: 'Bank reconciliation complete', evidence: 'note', dueOffsetMin: 2 * 540 },
    { key: 'ageing', title: 'Receivables ageing shared with the Sales Head', evidence: 'file', dueOffsetMin: 2 * 540 },
    { key: 'tally', title: 'Tally sync verified against LoyalFlow invoices', evidence: 'note', dueOffsetMin: 3 * 540 },
    { key: 'gst', title: 'GST working sent to the CA', evidence: 'file', dueOffsetMin: 5 * 540 }
  ] },
  { id: 'SOP-HR-ONBOARD', name: 'New-hire onboarding', department_id: 'HR', owner_role: 'ic', trigger: 'event', trigger_detail: 'hire', steps: [
    { key: 'm365', title: 'Microsoft 365 account created', evidence: 'none', dueOffsetMin: 540 },
    { key: 'lf', title: 'LoyalFlow account created from the employee master', evidence: 'record', dueOffsetMin: 540 },
    { key: 'assets', title: 'Laptop or device handed over and recorded', evidence: 'note', dueOffsetMin: 2 * 540 },
    { key: 'policies', title: 'Policies acknowledged', evidence: 'file', dueOffsetMin: 3 * 540 },
    { key: 'probation', title: 'Probation review date set with the manager', evidence: 'record', dueOffsetMin: 5 * 540 }
  ] }
];

export function seedMaster(app: App, opts: { password?: string; mustChange?: boolean } = {}): { employees: number } {
  const { db, cfg } = app;
  const nowIso = new Date().toISOString();
  const password = opts.password ?? cfg.seedPassword;
  const hash = hashPassword(password);
  const mustChange = opts.mustChange ?? !cfg.demo;
  db.transaction(() => {
    for (const s of SITES) db.run('INSERT OR IGNORE INTO sites (id, name, city) VALUES (?, ?, ?)', [s.id, s.name, s.city]);
    for (const d of DEPARTMENTS) db.run('INSERT OR IGNORE INTO departments (id, name, code, hod_id, shift_code, band) VALUES (?, ?, ?, ?, ?, ?)', [d.id, d.name, d.code, d.hod_id, d.shift_code, d.band]);
    for (const [id, name, designation, dept, subTeam, site, role, manager, shift] of EMPLOYEES) {
      const exists = db.get('SELECT id FROM employees WHERE id = ?', [id]);
      if (exists) continue;
      db.run(`INSERT INTO employees (id, full_name, email, password_hash, must_change_password, designation, department_id, sub_team, site_id, functional_role,
        reporting_manager_id, shift_code, employment_type, status, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Full-time', 'active', ?, ?, ?)`,
        [id, name, emailFor(name, cfg.emailDomain), hash, mustChange ? 1 : 0, designation, dept, subTeam, site, role, manager, shift, id === 'LS001' || id === 'LS002' ? 1 : 0, nowIso, nowIso]);
    }
    for (const s of SOPS) {
      db.run('INSERT OR IGNORE INTO sop_definitions (id, name, department_id, owner_role, trigger, trigger_detail, steps, version, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)',
        [s.id, s.name, s.department_id, s.owner_role, s.trigger, s.trigger_detail, JSON.stringify(s.steps), nowIso, nowIso]);
    }
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof typeof DEFAULT_SETTINGS)[]) {
      if (!db.get('SELECT key FROM settings WHERE key = ?', [key])) setSetting(db, key, DEFAULT_SETTINGS[key], null);
    }
    for (const [name, start] of [['T', 4200], ['D', 300], ['DL', 2240], ['WO', 1030], ['A', 100], ['S', 1000], ['C', 100], ['Q', 1180]] as const) {
      db.run('INSERT OR IGNORE INTO counters (name, value) VALUES (?, ?)', [name, start]);
    }
  });
  return { employees: EMPLOYEES.length };
}
