export interface Migration { id: string; sql: string }

export const MIGRATIONS: Migration[] = [
  {
    id: '0001_core',
    sql: `
CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT);

CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL DEFAULT '');

CREATE TABLE departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  hod_id TEXT,
  shift_code TEXT NOT NULL DEFAULT 'GEN',
  band TEXT NOT NULL DEFAULT 'people'
);

CREATE TABLE employees (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  designation TEXT NOT NULL DEFAULT '',
  department_id TEXT NOT NULL REFERENCES departments(id),
  sub_team TEXT NOT NULL DEFAULT '',
  site_id TEXT NOT NULL REFERENCES sites(id),
  functional_role TEXT NOT NULL DEFAULT 'ic',
  reporting_manager_id TEXT REFERENCES employees(id),
  secondary_manager_id TEXT REFERENCES employees(id),
  shift_code TEXT NOT NULL DEFAULT 'GEN',
  join_date TEXT,
  employment_type TEXT NOT NULL DEFAULT 'Full-time',
  status TEXT NOT NULL DEFAULT 'active',
  lang TEXT NOT NULL DEFAULT 'en',
  is_admin INTEGER NOT NULL DEFAULT 0,
  mobile TEXT NOT NULL DEFAULT '',
  pagarguru_code TEXT NOT NULL DEFAULT '',
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_employees_manager ON employees(reporting_manager_id);
CREATE INDEX idx_employees_department ON employees(department_id);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  kind TEXT NOT NULL DEFAULT 'web',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_sessions_employee ON sessions(employee_id);

CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  segment TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  owner_id TEXT REFERENCES employees(id),
  created_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_id TEXT,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before TEXT,
  after TEXT,
  request_id TEXT
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'info',
  created_at TEXT NOT NULL,
  read_at TEXT,
  emailed_at TEXT
);
CREATE INDEX idx_notifications_employee ON notifications(employee_id, read_at);
`
  },
  {
    id: '0002_desk',
    sql: `
CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  subject TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'support',
  category TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'P3',
  status TEXT NOT NULL DEFAULT 'new',
  assignee_id TEXT REFERENCES employees(id),
  created_by TEXT REFERENCES employees(id),
  channel TEXT NOT NULL DEFAULT 'phone',
  created_at TEXT NOT NULL,
  first_response_at TEXT,
  response_due_at TEXT,
  resolve_due_at TEXT,
  resolved_at TEXT,
  closed_at TEXT,
  within_sla INTEGER,
  dev_issue_id TEXT,
  rating INTEGER,
  rating_token TEXT,
  reopen_count INTEGER NOT NULL DEFAULT 0,
  impl_plan_days INTEGER,
  impl_stage TEXT,
  escalation_level INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_assignee ON tickets(assignee_id);
CREATE INDEX idx_tickets_customer ON tickets(customer_id);

CREATE TABLE ticket_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  actor_id TEXT,
  at TEXT NOT NULL,
  meta TEXT
);
CREATE INDEX idx_ticket_events_ticket ON ticket_events(ticket_id);

CREATE TABLE dev_issues (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'backlog',
  priority TEXT NOT NULL DEFAULT 'P3',
  sprint TEXT NOT NULL DEFAULT '',
  assignee_id TEXT REFERENCES employees(id),
  created_by TEXT REFERENCES employees(id),
  created_at TEXT NOT NULL,
  released_at TEXT,
  updated_at TEXT NOT NULL
);
`
  },
  {
    id: '0003_sales_production',
    sql: `
CREATE TABLE deals (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  title TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'new',
  value REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  owner_id TEXT NOT NULL REFERENCES employees(id),
  source TEXT NOT NULL DEFAULT '',
  next_step TEXT NOT NULL DEFAULT '',
  next_step_due TEXT,
  expected_close TEXT,
  stage_since TEXT NOT NULL,
  quote_attached INTEGER NOT NULL DEFAULT 0,
  discount_pct REAL NOT NULL DEFAULT 0,
  discount_status TEXT NOT NULL DEFAULT 'none',
  po_received INTEGER NOT NULL DEFAULT 0,
  qualified_need TEXT NOT NULL DEFAULT '',
  qualified_budget TEXT NOT NULL DEFAULT '',
  qualified_timeline TEXT NOT NULL DEFAULT '',
  won_at TEXT,
  lost_at TEXT,
  lost_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_deals_owner ON deals(owner_id);
CREATE INDEX idx_deals_stage ON deals(stage);

CREATE TABLE quotes (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL REFERENCES deals(id),
  version INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  list_total REAL NOT NULL,
  discount_pct REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  approved_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_quotes_deal ON quotes(deal_id);

CREATE TABLE activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id TEXT REFERENCES deals(id),
  customer_id TEXT REFERENCES customers(id),
  kind TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  actor_id TEXT NOT NULL REFERENCES employees(id),
  at TEXT NOT NULL,
  lat REAL,
  lng REAL,
  km REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_activities_deal ON activities(deal_id);
CREATE INDEX idx_activities_actor ON activities(actor_id, at);

CREATE TABLE work_orders (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'order',
  customer_id TEXT REFERENCES customers(id),
  deal_id TEXT REFERENCES deals(id),
  product TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  stage TEXT NOT NULL DEFAULT 'queued',
  assignee_id TEXT REFERENCES employees(id),
  promised_date TEXT,
  lead_time_days INTEGER NOT NULL DEFAULT 7,
  started_at TEXT,
  qc_result TEXT,
  packed_at TEXT,
  dispatched_at TEXT,
  delivered_at TEXT,
  courier TEXT NOT NULL DEFAULT '',
  consignment TEXT NOT NULL DEFAULT '',
  invoice_ref TEXT NOT NULL DEFAULT '',
  photo_path TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES employees(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_work_orders_stage ON work_orders(stage);
`
  },
  {
    id: '0004_tasks_sops_kpi',
    sql: `
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'task',
  type TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  amount REAL,
  assignee_id TEXT REFERENCES employees(id),
  requester_id TEXT REFERENCES employees(id),
  created_by TEXT REFERENCES employees(id),
  status TEXT NOT NULL DEFAULT 'open',
  due_at TEXT,
  decided_at TEXT,
  decided_by TEXT REFERENCES employees(id),
  decision_note TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  link TEXT NOT NULL DEFAULT '',
  minutes_logged INTEGER NOT NULL DEFAULT 0,
  timer_started_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id, status);

CREATE TABLE leave_requests (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  type TEXT NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  days REAL NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  task_id TEXT REFERENCES tasks(id),
  created_at TEXT NOT NULL
);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  receipt_path TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  task_id TEXT REFERENCES tasks(id),
  created_at TEXT NOT NULL
);

CREATE TABLE sop_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  department_id TEXT REFERENCES departments(id),
  owner_role TEXT NOT NULL DEFAULT 'team_lead',
  trigger TEXT NOT NULL DEFAULT 'daily',
  trigger_detail TEXT NOT NULL DEFAULT '',
  steps TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sop_instances (
  id TEXT PRIMARY KEY,
  sop_id TEXT NOT NULL REFERENCES sop_definitions(id),
  sop_version INTEGER NOT NULL,
  date TEXT NOT NULL,
  assignee_id TEXT REFERENCES employees(id),
  department_id TEXT REFERENCES departments(id),
  steps TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  due_at TEXT NOT NULL,
  escalation_level INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(sop_id, date, assignee_id)
);
CREATE INDEX idx_sop_instances_assignee ON sop_instances(assignee_id, date);

CREATE TABLE kpi_snapshots (
  key TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  period TEXT NOT NULL,
  value REAL,
  target REAL,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (key, scope_type, scope_id, period)
);

CREATE TABLE kpi_targets (
  key TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  target REAL NOT NULL,
  set_by TEXT,
  set_at TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (key, scope_type, scope_id)
);

CREATE TABLE attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  date TEXT NOT NULL,
  check_in TEXT,
  check_out TEXT,
  source TEXT NOT NULL DEFAULT 'self',
  status TEXT NOT NULL DEFAULT 'present',
  UNIQUE(employee_id, date)
);
`
  },
  {
    id: '0005_phase2',
    sql: `
CREATE TABLE imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  rows TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'preview',
  created_by TEXT REFERENCES employees(id),
  created_at TEXT NOT NULL,
  committed_at TEXT,
  result TEXT
);

CREATE TABLE time_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  minutes INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_time_logs_entity ON time_logs(entity_type, entity_id);
CREATE INDEX idx_time_logs_employee ON time_logs(employee_id, started_at);

CREATE TABLE procurement_items (
  id TEXT PRIMARY KEY,
  item TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'pcs',
  needed_by TEXT,
  supplier TEXT NOT NULL DEFAULT '',
  est_cost REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planned',
  work_order_id TEXT REFERENCES work_orders(id),
  deal_id TEXT REFERENCES deals(id),
  ordered_at TEXT,
  expected_at TEXT,
  received_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES employees(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE budgets (
  department_id TEXT NOT NULL REFERENCES departments(id),
  fiscal_year TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  set_by TEXT REFERENCES employees(id),
  set_at TEXT NOT NULL,
  PRIMARY KEY (department_id, fiscal_year)
);

ALTER TABLE work_orders ADD COLUMN materials_status TEXT NOT NULL DEFAULT 'unchecked';
ALTER TABLE work_orders ADD COLUMN materials_note TEXT NOT NULL DEFAULT '';
ALTER TABLE work_orders ADD COLUMN planned_hours REAL;
ALTER TABLE expenses ADD COLUMN deal_id TEXT REFERENCES deals(id);
ALTER TABLE expenses ADD COLUMN km REAL;
ALTER TABLE tasks ADD COLUMN department_id TEXT;
`
  },
  {
    id: '0006_dev_pm',
    sql: `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'product',
  status TEXT NOT NULL DEFAULT 'active',
  owner_id TEXT REFERENCES employees(id),
  customer_id TEXT REFERENCES customers(id),
  start_date TEXT,
  target_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES employees(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sprints (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  goal TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned',
  committed_points REAL NOT NULL DEFAULT 0,
  committed_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE TABLE releases (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  project_id TEXT REFERENCES projects(id),
  planned_date TEXT,
  released_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  qa_signed_by TEXT REFERENCES employees(id),
  qa_signed_at TEXT,
  hod_approved_by TEXT REFERENCES employees(id),
  hod_approved_at TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  created_by TEXT REFERENCES employees(id),
  created_at TEXT NOT NULL
);

CREATE TABLE issue_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id TEXT NOT NULL REFERENCES dev_issues(id),
  author_id TEXT REFERENCES employees(id),
  kind TEXT NOT NULL DEFAULT 'comment',
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_issue_comments ON issue_comments(issue_id);

CREATE TABLE issue_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id TEXT NOT NULL REFERENCES dev_issues(id),
  kind TEXT NOT NULL DEFAULT 'subtask',
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  done_by TEXT REFERENCES employees(id),
  done_at TEXT,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_issue_checks ON issue_checks(issue_id);

ALTER TABLE dev_issues ADD COLUMN project_id TEXT REFERENCES projects(id);
ALTER TABLE dev_issues ADD COLUMN sprint_id TEXT REFERENCES sprints(id);
ALTER TABLE dev_issues ADD COLUMN release_id TEXT REFERENCES releases(id);
ALTER TABLE dev_issues ADD COLUMN type TEXT NOT NULL DEFAULT 'feature';
ALTER TABLE dev_issues ADD COLUMN points REAL;
ALTER TABLE dev_issues ADD COLUMN estimate_hours REAL;
ALTER TABLE dev_issues ADD COLUMN component TEXT NOT NULL DEFAULT '';
ALTER TABLE dev_issues ADD COLUMN acceptance TEXT NOT NULL DEFAULT '';
ALTER TABLE dev_issues ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dev_issues ADD COLUMN blocked_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE dev_issues ADD COLUMN started_at TEXT;
ALTER TABLE dev_issues ADD COLUMN qa_at TEXT;
ALTER TABLE dev_issues ADD COLUMN reporter_id TEXT REFERENCES employees(id);
ALTER TABLE dev_issues ADD COLUMN customer_id TEXT REFERENCES customers(id);
ALTER TABLE dev_issues ADD COLUMN reopen_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dev_issues ADD COLUMN due_date TEXT;
`
  },
  {
    id: '0007_hr',
    sql: `
CREATE TABLE salary_structures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  effective_from TEXT NOT NULL,
  ctc_annual REAL NOT NULL DEFAULT 0,
  basic REAL NOT NULL DEFAULT 0,
  hra REAL NOT NULL DEFAULT 0,
  conveyance REAL NOT NULL DEFAULT 0,
  special REAL NOT NULL DEFAULT 0,
  other_earnings TEXT NOT NULL DEFAULT '{}',
  pf_applicable INTEGER NOT NULL DEFAULT 1,
  pf_on_full_basic INTEGER NOT NULL DEFAULT 0,
  esi_applicable INTEGER NOT NULL DEFAULT 1,
  pt_applicable INTEGER NOT NULL DEFAULT 1,
  bank_account TEXT NOT NULL DEFAULT '',
  bank_ifsc TEXT NOT NULL DEFAULT '',
  pan TEXT NOT NULL DEFAULT '',
  uan TEXT NOT NULL DEFAULT '',
  esic_number TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES employees(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_salary_employee ON salary_structures(employee_id, effective_from);

CREATE TABLE payroll_runs (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  gross REAL NOT NULL DEFAULT 0,
  deductions REAL NOT NULL DEFAULT 0,
  net REAL NOT NULL DEFAULT 0,
  employer_cost REAL NOT NULL DEFAULT 0,
  headcount INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES employees(id),
  created_at TEXT NOT NULL,
  approved_by TEXT REFERENCES employees(id),
  approved_at TEXT,
  paid_at TEXT,
  UNIQUE(month)
);

CREATE TABLE payslips (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES payroll_runs(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  month TEXT NOT NULL,
  working_days REAL NOT NULL DEFAULT 0,
  present_days REAL NOT NULL DEFAULT 0,
  paid_leave_days REAL NOT NULL DEFAULT 0,
  lop_days REAL NOT NULL DEFAULT 0,
  earnings TEXT NOT NULL DEFAULT '{}',
  deductions TEXT NOT NULL DEFAULT '{}',
  employer TEXT NOT NULL DEFAULT '{}',
  gross REAL NOT NULL DEFAULT 0,
  total_deductions REAL NOT NULL DEFAULT 0,
  net REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(run_id, employee_id)
);
CREATE INDEX idx_payslips_employee ON payslips(employee_id, month);

CREATE TABLE tax_declarations (
  employee_id TEXT NOT NULL REFERENCES employees(id),
  fiscal_year TEXT NOT NULL,
  regime TEXT NOT NULL DEFAULT 'new',
  s80c REAL NOT NULL DEFAULT 0,
  s80d REAL NOT NULL DEFAULT 0,
  s80ccd1b REAL NOT NULL DEFAULT 0,
  home_loan_interest REAL NOT NULL DEFAULT 0,
  rent_paid_monthly REAL NOT NULL DEFAULT 0,
  metro INTEGER NOT NULL DEFAULT 0,
  other_income REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  proof_note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (employee_id, fiscal_year)
);

CREATE TABLE attendance_regularisations (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  date TEXT NOT NULL,
  requested_in TEXT,
  requested_out TEXT,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  task_id TEXT REFERENCES tasks(id),
  decided_by TEXT REFERENCES employees(id),
  decided_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_regularisation_employee ON attendance_regularisations(employee_id, date);

CREATE TABLE appraisal_cycles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  self_due TEXT,
  manager_due TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT REFERENCES employees(id),
  created_at TEXT NOT NULL
);

CREATE TABLE appraisals (
  id TEXT PRIMARY KEY,
  cycle_id TEXT REFERENCES appraisal_cycles(id),
  kind TEXT NOT NULL DEFAULT 'annual',
  employee_id TEXT NOT NULL REFERENCES employees(id),
  manager_id TEXT REFERENCES employees(id),
  status TEXT NOT NULL DEFAULT 'open',
  self_review TEXT NOT NULL DEFAULT '',
  self_rating REAL,
  self_at TEXT,
  manager_review TEXT NOT NULL DEFAULT '',
  manager_rating REAL,
  manager_at TEXT,
  kpi_snapshot TEXT NOT NULL DEFAULT '[]',
  final_rating REAL,
  increment_pct REAL,
  increment_amount REAL,
  decision TEXT NOT NULL DEFAULT '',
  approval_task_id TEXT REFERENCES tasks(id),
  approved_by TEXT REFERENCES employees(id),
  approved_at TEXT,
  due_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_appraisals_employee ON appraisals(employee_id);

CREATE TABLE requisitions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  department_id TEXT REFERENCES departments(id),
  positions INTEGER NOT NULL DEFAULT 1,
  employment_type TEXT NOT NULL DEFAULT 'full_time',
  experience TEXT NOT NULL DEFAULT '',
  budget_ctc REAL,
  location TEXT NOT NULL DEFAULT '',
  justification TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  workflow_version INTEGER NOT NULL DEFAULT 1,
  hiring_manager_id TEXT REFERENCES employees(id),
  recruiter_id TEXT REFERENCES employees(id),
  approval_task_id TEXT REFERENCES tasks(id),
  approved_by TEXT REFERENCES employees(id),
  approved_at TEXT,
  closed_at TEXT,
  created_by TEXT REFERENCES employees(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE candidates (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  email_normalized TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  current_employer TEXT NOT NULL DEFAULT '',
  experience_years REAL,
  current_ctc REAL,
  expected_ctc REAL,
  notice_days INTEGER,
  location TEXT NOT NULL DEFAULT '',
  cv_path TEXT NOT NULL DEFAULT '',
  cv_text TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  consent_at TEXT,
  created_by TEXT REFERENCES employees(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_candidates_email ON candidates(email_normalized);

CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  requisition_id TEXT NOT NULL REFERENCES requisitions(id),
  source TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL,
  owner_id TEXT REFERENCES employees(id),
  stage TEXT NOT NULL DEFAULT 'applied',
  stage_since TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  outcome TEXT NOT NULL DEFAULT '',
  outcome_reason TEXT NOT NULL DEFAULT '',
  decision_by TEXT REFERENCES employees(id),
  decision_at TEXT,
  workflow_version INTEGER NOT NULL DEFAULT 1,
  screening_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(candidate_id, requisition_id)
);
CREATE INDEX idx_applications_req ON applications(requisition_id, stage);

CREATE TABLE application_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT NOT NULL REFERENCES applications(id),
  kind TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  from_stage TEXT,
  to_stage TEXT,
  actor_id TEXT REFERENCES employees(id),
  at TEXT NOT NULL
);
CREATE INDEX idx_application_events ON application_events(application_id);

CREATE TABLE interviews (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id),
  round INTEGER NOT NULL DEFAULT 1,
  round_type TEXT NOT NULL DEFAULT 'technical',
  mode TEXT NOT NULL DEFAULT 'in_person',
  location TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  previous_starts_at TEXT,
  reschedule_reason TEXT NOT NULL DEFAULT '',
  candidate_informed INTEGER NOT NULL DEFAULT 0,
  calibrated_at TEXT,
  created_by TEXT REFERENCES employees(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_interviews_app ON interviews(application_id);

CREATE TABLE interview_panel (
  interview_id TEXT NOT NULL REFERENCES interviews(id),
  interviewer_id TEXT NOT NULL REFERENCES employees(id),
  PRIMARY KEY (interview_id, interviewer_id)
);

CREATE TABLE scorecards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  interview_id TEXT NOT NULL REFERENCES interviews(id),
  interviewer_id TEXT NOT NULL REFERENCES employees(id),
  ratings TEXT NOT NULL DEFAULT '{}',
  overall REAL,
  recommendation TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '',
  submitted_at TEXT,
  reopened_by TEXT REFERENCES employees(id),
  reopened_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(interview_id, interviewer_id)
);

CREATE TABLE offers (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id),
  ctc_annual REAL NOT NULL DEFAULT 0,
  designation TEXT NOT NULL DEFAULT '',
  department_id TEXT REFERENCES departments(id),
  joining_date TEXT,
  expiry_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  body TEXT NOT NULL DEFAULT '',
  issued_by TEXT REFERENCES employees(id),
  issued_at TEXT,
  responded_at TEXT,
  response_note TEXT NOT NULL DEFAULT '',
  approval_task_id TEXT REFERENCES tasks(id),
  created_by TEXT REFERENCES employees(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_offers_app ON offers(application_id);

ALTER TABLE employees ADD COLUMN probation_until TEXT;
ALTER TABLE employees ADD COLUMN date_of_birth TEXT;
ALTER TABLE employees ADD COLUMN gender TEXT NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN hired_from_candidate TEXT;
ALTER TABLE attendance ADD COLUMN minutes_late INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attendance ADD COLUMN day_value REAL NOT NULL DEFAULT 1;
ALTER TABLE attendance ADD COLUMN note TEXT NOT NULL DEFAULT '';
`
  },
  {
    id: '0008_loyalhire_workflow',
    sql: `
ALTER TABLE requisitions ADD COLUMN approval_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE requisitions ADD COLUMN work_mode TEXT NOT NULL DEFAULT 'office';
ALTER TABLE requisitions ADD COLUMN target_date TEXT;
ALTER TABLE requisitions ADD COLUMN paused_at TEXT;
ALTER TABLE applications ADD COLUMN hold_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN hold_until TEXT;

CREATE TABLE hiring_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT NOT NULL REFERENCES applications(id),
  outcome TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '{}',
  decided_by TEXT REFERENCES employees(id),
  decided_at TEXT NOT NULL
);
CREATE INDEX idx_hiring_decisions_app ON hiring_decisions(application_id);

CREATE TABLE onboardings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT NOT NULL REFERENCES applications(id),
  offer_id TEXT REFERENCES offers(id),
  employee_id TEXT REFERENCES employees(id),
  status TEXT NOT NULL DEFAULT 'not_started',
  created_at TEXT NOT NULL,
  completed_at TEXT,
  completed_by TEXT REFERENCES employees(id)
);
CREATE INDEX idx_onboardings_app ON onboardings(application_id);

CREATE TABLE onboarding_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  onboarding_id INTEGER NOT NULL REFERENCES onboardings(id),
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  gate INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT REFERENCES employees(id),
  due_date TEXT,
  done_at TEXT,
  done_by TEXT REFERENCES employees(id)
);
CREATE INDEX idx_onboarding_items_ob ON onboarding_items(onboarding_id, position);

-- Approval now happens outside the app: vacancies and offers that were waiting inside it go back to draft,
-- approved offers become drafts HR can issue, and the approval tasks they raised are withdrawn.
UPDATE requisitions SET status = 'draft' WHERE status IN ('pending', 'declined');
UPDATE requisitions SET approval_ref = 'Approved in LoyalFlow before v1.7' WHERE status IN ('open', 'closed') AND approval_ref = '';
UPDATE offers SET status = 'draft' WHERE status IN ('pending', 'approved');
UPDATE offers SET status = 'cancelled' WHERE status = 'rejected';
UPDATE tasks SET status = 'cancelled' WHERE status IN ('open', 'pending') AND (payload LIKE '%"kind":"requisition"%' OR payload LIKE '%"kind":"offer"%');
-- A hold is no longer a way of closing an application.
UPDATE applications SET status = 'on_hold', hold_reason = outcome_reason, outcome = '', outcome_reason = '' WHERE status = 'closed' AND outcome = 'on_hold';
UPDATE applications SET outcome = 'offer_declined' WHERE outcome = 'declined_offer';
`
  },
  {
    id: '0009_loyalhire_assessment',
    sql: `
CREATE TABLE assessment_invitations (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id),
  batch_id TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL,
  template_version INTEGER NOT NULL DEFAULT 1,
  token_hash TEXT NOT NULL UNIQUE,
  token_cipher TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'invited',
  expires_at TEXT NOT NULL,
  send_state TEXT NOT NULL DEFAULT 'not_sent',
  send_detail TEXT NOT NULL DEFAULT '',
  sent_at TEXT,
  reminder1_at TEXT,
  reminder2_at TEXT,
  started_at TEXT,
  deadline_at TEXT,
  submitted_at TEXT,
  answers TEXT NOT NULL DEFAULT '{}',
  writing TEXT NOT NULL DEFAULT '',
  objective_score INTEGER,
  objective_total INTEGER,
  reading_score INTEGER,
  language_score INTEGER,
  review TEXT NOT NULL DEFAULT '{}',
  review_total INTEGER,
  review_note TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT REFERENCES employees(id),
  reviewed_at TEXT,
  created_by TEXT REFERENCES employees(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_assessment_app ON assessment_invitations(application_id, status);
CREATE INDEX idx_assessment_status ON assessment_invitations(status, expires_at);

CREATE TABLE hire_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT NOT NULL REFERENCES applications(id),
  kind TEXT NOT NULL,
  recipient TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  provider_ref TEXT NOT NULL DEFAULT '',
  related_id TEXT NOT NULL DEFAULT '',
  actor_id TEXT REFERENCES employees(id),
  at TEXT NOT NULL
);
CREATE INDEX idx_hire_messages_app ON hire_messages(application_id, at);
`
  },
  {
    id: '0010_loyalhire_sourcing',
    sql: `
-- Screening questions: a company default set (requisition_id NULL) and optional sets per vacancy. Editing makes a new version.
CREATE TABLE screening_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requisition_id TEXT REFERENCES requisitions(id),
  version INTEGER NOT NULL DEFAULT 1,
  questions TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES employees(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_screening_sets_req ON screening_sets(requisition_id, active);

CREATE TABLE screening_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT NOT NULL UNIQUE REFERENCES applications(id),
  set_id INTEGER NOT NULL REFERENCES screening_sets(id),
  answers TEXT NOT NULL DEFAULT '{}',
  total INTEGER NOT NULL DEFAULT 0,
  max_total INTEGER NOT NULL DEFAULT 0,
  must_missed INTEGER NOT NULL DEFAULT 0,
  reviewed_by TEXT REFERENCES employees(id),
  reviewed_at TEXT NOT NULL
);

-- Interview plan: an ordered list of rounds per vacancy. Advice, not a rule.
ALTER TABLE requisitions ADD COLUMN interview_plan TEXT NOT NULL DEFAULT '[]';
ALTER TABLE interviews ADD COLUMN round_name TEXT NOT NULL DEFAULT '';

-- CV upload and summary.
ALTER TABLE candidates ADD COLUMN cv_name TEXT NOT NULL DEFAULT '';
ALTER TABLE candidates ADD COLUMN cv_mime TEXT NOT NULL DEFAULT '';
ALTER TABLE candidates ADD COLUMN cv_summary TEXT NOT NULL DEFAULT '';
ALTER TABLE candidates ADD COLUMN cv_data TEXT NOT NULL DEFAULT '{}';
ALTER TABLE candidates ADD COLUMN cv_source TEXT NOT NULL DEFAULT '';
ALTER TABLE candidates ADD COLUMN cv_uploaded_at TEXT;

CREATE TABLE cv_staging (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  requisition_id TEXT NOT NULL REFERENCES requisitions(id),
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  parsed TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES employees(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_cv_staging_batch ON cv_staging(batch_id);
`
  },
  {
    id: '0011_attendance_machine',
    sql: `
-- Punching machines (ZKTeco push) and every raw punch they send. Raw punches are never edited.
CREATE TABLE punch_devices (
  sn TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  last_ip TEXT NOT NULL DEFAULT '',
  info TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES employees(id),
  created_at TEXT NOT NULL
);
CREATE TABLE punches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_sn TEXT NOT NULL,
  pin TEXT NOT NULL,
  employee_id TEXT REFERENCES employees(id),
  at TEXT NOT NULL,
  local_date TEXT NOT NULL,
  local_time TEXT NOT NULL,
  status_code INTEGER,
  verify INTEGER,
  source TEXT NOT NULL DEFAULT 'push',
  created_at TEXT NOT NULL,
  UNIQUE(device_sn, pin, at)
);
CREATE INDEX idx_punches_emp ON punches(employee_id, local_date);
CREATE INDEX idx_punches_pin ON punches(pin);

ALTER TABLE employees ADD COLUMN device_pin TEXT NOT NULL DEFAULT '';
ALTER TABLE attendance ADD COLUMN penalty TEXT NOT NULL DEFAULT '';

-- Miss-punch requests: team lead validates, HR approves, each with a comment.
ALTER TABLE attendance_regularisations ADD COLUMN kind TEXT NOT NULL DEFAULT 'both';
ALTER TABLE attendance_regularisations ADD COLUMN reason_code TEXT NOT NULL DEFAULT 'other';
ALTER TABLE attendance_regularisations ADD COLUMN validated_by TEXT REFERENCES employees(id);
ALTER TABLE attendance_regularisations ADD COLUMN validated_at TEXT;
ALTER TABLE attendance_regularisations ADD COLUMN validator_note TEXT NOT NULL DEFAULT '';
ALTER TABLE attendance_regularisations ADD COLUMN hr_note TEXT NOT NULL DEFAULT '';
ALTER TABLE attendance_regularisations ADD COLUMN hr_task_id TEXT REFERENCES tasks(id);
ALTER TABLE attendance_regularisations ADD COLUMN declined_stage TEXT NOT NULL DEFAULT '';

-- Leave: reporting manager first, HR final.
ALTER TABLE leave_requests ADD COLUMN manager_by TEXT REFERENCES employees(id);
ALTER TABLE leave_requests ADD COLUMN manager_at TEXT;
ALTER TABLE leave_requests ADD COLUMN manager_note TEXT NOT NULL DEFAULT '';
ALTER TABLE leave_requests ADD COLUMN hr_by TEXT REFERENCES employees(id);
ALTER TABLE leave_requests ADD COLUMN hr_at TEXT;
ALTER TABLE leave_requests ADD COLUMN hr_note TEXT NOT NULL DEFAULT '';
ALTER TABLE leave_requests ADD COLUMN hr_task_id TEXT REFERENCES tasks(id);
`
  },
  {
    id: '0012_roles',
    sql: `
-- Roles and permissions. An employee with no role_id gets the automatic role for their department and level.
CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT 'self',
  perms TEXT NOT NULL DEFAULT '{}',
  auto INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
ALTER TABLE employees ADD COLUMN role_id TEXT;
`
  },
  {
    id: '0013_estimates',
    sql: `
-- Product catalogue and estimates with line items. zoho_* columns are filled once Zoho Books is connected.
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'Nos',
  price REAL NOT NULL DEFAULT 0,
  hsn TEXT NOT NULL DEFAULT '',
  gst_rate REAL NOT NULL DEFAULT 18,
  image_path TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  zoho_item_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE estimates (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  deal_id TEXT NOT NULL REFERENCES deals(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'draft',
  currency TEXT NOT NULL DEFAULT 'INR',
  estimate_date TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  tax_mode TEXT NOT NULL DEFAULT 'intra',
  bill_name TEXT NOT NULL DEFAULT '',
  bill_address TEXT NOT NULL DEFAULT '',
  bill_gstin TEXT NOT NULL DEFAULT '',
  bill_contact TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  terms TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  gross REAL NOT NULL DEFAULT 0,
  discount_total REAL NOT NULL DEFAULT 0,
  taxable REAL NOT NULL DEFAULT 0,
  tax_total REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  share_token TEXT,
  sent_at TEXT,
  decided_at TEXT,
  decided_by TEXT NOT NULL DEFAULT '',
  decision_note TEXT NOT NULL DEFAULT '',
  zoho_estimate_id TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES employees(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_estimates_deal ON estimates(deal_id);
CREATE UNIQUE INDEX idx_estimates_token ON estimates(share_token) WHERE share_token IS NOT NULL;
CREATE TABLE estimate_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estimate_id TEXT NOT NULL REFERENCES estimates(id),
  position INTEGER NOT NULL,
  product_id TEXT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  hsn TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'Nos',
  qty REAL NOT NULL DEFAULT 1,
  rate REAL NOT NULL DEFAULT 0,
  discount_pct REAL NOT NULL DEFAULT 0,
  gst_rate REAL NOT NULL DEFAULT 18,
  image_path TEXT NOT NULL DEFAULT '',
  taxable REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_estimate_items ON estimate_items(estimate_id, position);
ALTER TABLE customers ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN gstin TEXT NOT NULL DEFAULT '';
`
  },
  {
    id: '0014_dsr',
    sql: `
-- Daily review (DSR): one day per team, lines planned in the morning and reviewed in the evening.
CREATE TABLE dsr_days (
  id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES departments(id),
  day TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT NOT NULL DEFAULT '',
  closed_at TEXT,
  closed_by TEXT REFERENCES employees(id),
  created_at TEXT NOT NULL,
  UNIQUE (department_id, day)
);
CREATE TABLE dsr_items (
  id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES departments(id),
  day TEXT NOT NULL,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  kind TEXT NOT NULL DEFAULT 'task',
  title TEXT NOT NULL DEFAULT '',
  customer TEXT NOT NULL DEFAULT '',
  ref TEXT NOT NULL DEFAULT '',
  planned_hours REAL,
  amount_expected REAL,
  self_status TEXT NOT NULL DEFAULT '',
  self_pct INTEGER,
  self_amount REAL,
  self_note TEXT NOT NULL DEFAULT '',
  self_at TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  pct INTEGER,
  amount_actual REAL,
  remark TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT REFERENCES employees(id),
  reviewed_at TEXT,
  carry TEXT NOT NULL DEFAULT '',
  carried_from TEXT,
  carried_to TEXT,
  carry_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES employees(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_dsr_items_day ON dsr_items(department_id, day);
CREATE INDEX idx_dsr_items_emp ON dsr_items(employee_id, day);
`
  },
  {
    id: '0015_targets',
    sql: `
-- Monthly targets for the company overview, and who may set them.
CREATE TABLE team_targets (
  measure TEXT NOT NULL,
  month TEXT NOT NULL,
  value REAL NOT NULL,
  set_by TEXT REFERENCES employees(id),
  set_at TEXT NOT NULL,
  PRIMARY KEY (measure, month)
);
CREATE TABLE target_setters (
  employee_id TEXT NOT NULL REFERENCES employees(id),
  department_id TEXT NOT NULL,
  granted_by TEXT REFERENCES employees(id),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (employee_id, department_id)
);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
`
  },
  {
    id: '0016_estimate_supply_and_hourly_log',
    sql: `
-- Place of supply printed on an estimate (state name with its GST code).
ALTER TABLE estimates ADD COLUMN place_of_supply TEXT NOT NULL DEFAULT '';
-- Hour-by-hour work log: the time a daily-review line covers.
ALTER TABLE dsr_items ADD COLUMN slot_from TEXT NOT NULL DEFAULT '';
ALTER TABLE dsr_items ADD COLUMN slot_to TEXT NOT NULL DEFAULT '';
`
  },
  {
    id: '0017_work_sessions',
    sql: `
-- What a person is working on, and their breaks: one line each time they start, pause or stop.
CREATE TABLE work_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'work',
  note TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  minutes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_work_sessions_person ON work_sessions(employee_id, started_at);
CREATE INDEX idx_work_sessions_item ON work_sessions(entity_type, entity_id);
`
  },
  {
    id: '0018_coo_email',
    sql: `
-- The COO's work email changed (25 Nov 2026). Only the old address is rewritten, so a later change is not undone.
UPDATE employees SET email = 'sridhar.ngowda@loyalstring.com' WHERE id = 'LS002' AND email = 'sridhar.narayanagowda@loyalstring.com';
`
  },
  {
    id: '0019_expense_ledger',
    sql: `
-- Expenses go on to Accounts after approval: reimbursements, advances and advance settlements, each paid and recorded.
ALTER TABLE expenses ADD COLUMN kind TEXT NOT NULL DEFAULT 'reimbursement';
ALTER TABLE expenses ADD COLUMN expense_date TEXT;
ALTER TABLE expenses ADD COLUMN advance_id TEXT REFERENCES expenses(id);
ALTER TABLE expenses ADD COLUMN paid_at TEXT;
ALTER TABLE expenses ADD COLUMN paid_by TEXT REFERENCES employees(id);
ALTER TABLE expenses ADD COLUMN pay_mode TEXT NOT NULL DEFAULT '';
ALTER TABLE expenses ADD COLUMN pay_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE expenses ADD COLUMN settled_at TEXT;
-- Bills, receipts and payment proofs. The files sit outside the public uploads folder.
CREATE TABLE expense_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id TEXT NOT NULL REFERENCES expenses(id),
  kind TEXT NOT NULL DEFAULT 'bill',
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT REFERENCES employees(id),
  uploaded_at TEXT NOT NULL
);
CREATE INDEX idx_expense_docs ON expense_docs(expense_id);
-- One line for every rupee approved, paid, advanced or returned. debit: money to the person. credit: owed to, or accounted for by, the person.
CREATE TABLE expense_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  expense_id TEXT REFERENCES expenses(id),
  entry_date TEXT NOT NULL,
  type TEXT NOT NULL,
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT '',
  ref TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES employees(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_expense_ledger_person ON expense_ledger(employee_id, entry_date);
CREATE INDEX idx_expense_ledger_claim ON expense_ledger(expense_id);
-- Claims approved before this change are owed to the person until Accounts marks them paid.
INSERT INTO expense_ledger (employee_id, expense_id, entry_date, type, debit, credit, note, created_at)
  SELECT employee_id, id, date(created_at, '+330 minutes'), 'claim_approved', 0, amount, category, created_at FROM expenses WHERE status = 'approved';
`
  },
  {
    id: '0020_money_extras',
    sql: `
-- Vendor bills and petty cash sit in the same ledger; GST details on bills; limits, reminders and month close.
ALTER TABLE expenses ADD COLUMN department_id TEXT REFERENCES departments(id);
ALTER TABLE expenses ADD COLUMN vendor_name TEXT NOT NULL DEFAULT '';
ALTER TABLE expenses ADD COLUMN vendor_gstin TEXT NOT NULL DEFAULT '';
ALTER TABLE expenses ADD COLUMN bill_no TEXT NOT NULL DEFAULT '';
ALTER TABLE expenses ADD COLUMN gst_amount REAL;
ALTER TABLE expenses ADD COLUMN over_limit REAL;
ALTER TABLE expenses ADD COLUMN reminded_at TEXT;
-- Whose account a ledger line belongs to: an employee, a vendor, or the petty-cash box.
ALTER TABLE expense_ledger ADD COLUMN party TEXT NOT NULL DEFAULT 'employee';
CREATE TABLE expense_limits (category TEXT PRIMARY KEY, per_claim REAL NOT NULL, updated_by TEXT REFERENCES employees(id), updated_at TEXT NOT NULL);
CREATE TABLE ledger_months (month TEXT PRIMARY KEY, closed_at TEXT, closed_by TEXT REFERENCES employees(id), posted_at TEXT, posted_by TEXT REFERENCES employees(id));
CREATE TABLE money_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`
  }
];
