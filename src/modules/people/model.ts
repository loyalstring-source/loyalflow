import type { Db } from '../../db/index.ts';

export type FunctionalRole = 'executive' | 'hod' | 'team_lead' | 'ic';

export interface Employee {
  id: string;
  full_name: string;
  email: string;
  password_hash: string | null;
  must_change_password: number;
  designation: string;
  department_id: string;
  sub_team: string;
  site_id: string;
  functional_role: FunctionalRole;
  reporting_manager_id: string | null;
  secondary_manager_id: string | null;
  shift_code: string;
  join_date: string | null;
  employment_type: string;
  status: string;
  lang: string;
  is_admin: number;
  mobile: string;
  pagarguru_code: string;
  failed_logins: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  probation_until: string | null;
  date_of_birth: string | null;
  gender: string;
  hired_from_candidate: string | null;
}

export interface Department { id: string; name: string; code: string; hod_id: string | null; shift_code: string; band: string }
export interface Site { id: string; name: string; city: string }

export function getEmployee(db: Db, id: string): Employee | undefined {
  return db.get<Employee>('SELECT * FROM employees WHERE id = ?', [id]);
}

export function getEmployeeByEmail(db: Db, email: string): Employee | undefined {
  return db.get<Employee>('SELECT * FROM employees WHERE lower(email) = lower(?)', [email.trim()]);
}

export function listEmployees(db: Db, opts: { status?: string; departmentId?: string } = {}): Employee[] {
  const where: string[] = []; const params: (string)[] = [];
  if (opts.status) { where.push('status = ?'); params.push(opts.status); }
  if (opts.departmentId) { where.push('department_id = ?'); params.push(opts.departmentId); }
  return db.all<Employee>(`SELECT * FROM employees ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY department_id, full_name`, params);
}

export function listDepartments(db: Db): Department[] { return db.all<Department>('SELECT * FROM departments ORDER BY name'); }
export function getDepartment(db: Db, id: string): Department | undefined { return db.get<Department>('SELECT * FROM departments WHERE id = ?', [id]); }
export function listSites(db: Db): Site[] { return db.all<Site>('SELECT * FROM sites ORDER BY name'); }

/** Every employee that reports, directly or indirectly, to the given manager (excluding the manager). */
export function subtreeIds(db: Db, managerId: string): string[] {
  return db.all<{ id: string }>(`
    WITH RECURSIVE tree(id) AS (
      SELECT id FROM employees WHERE reporting_manager_id = ? OR secondary_manager_id = ?
      UNION
      SELECT e.id FROM employees e JOIN tree t ON e.reporting_manager_id = t.id
    ) SELECT id FROM tree`, [managerId, managerId]).map((r) => r.id);
}

export function directReports(db: Db, managerId: string): Employee[] {
  return db.all<Employee>("SELECT * FROM employees WHERE reporting_manager_id = ? AND status = 'active' ORDER BY full_name", [managerId]);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function firstName(name: string): string { return name.trim().split(/\s+/)[0]; }

/** Validate a reporting line change: manager must exist, be active and not create a cycle. */
export function validateReportingLine(db: Db, employeeId: string, managerId: string | null): string | null {
  if (!managerId) return null;
  if (managerId === employeeId) return 'Nobody can report to themself.';
  const m = getEmployee(db, managerId);
  if (!m) return 'The reporting manager must be an existing employee.';
  if (m.status !== 'active') return 'The reporting manager must be an active employee.';
  if (subtreeIds(db, employeeId).includes(managerId)) return 'That would create a loop in the reporting line.';
  return null;
}
