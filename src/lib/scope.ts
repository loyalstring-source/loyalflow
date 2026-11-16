import type { Db } from '../db/index.ts';
import { getSetting } from './settings.ts';
import { getDepartment, subtreeIds, type Employee } from '../modules/people/model.ts';
import { atLeast, levelOf, dataScope, type ModuleKey, type Level } from './roles.ts';

export type Action =
  | 'desk.view' | 'desk.write' | 'desk.manage' | 'dev.write'
  | 'sales.view' | 'sales.write' | 'sales.manage'
  | 'production.view' | 'production.write'
  | 'people.view' | 'people.admin' | 'settings.admin'
  | 'reports.company' | 'reports.export' | 'sops.manage' | 'tasks.assign'
  | 'hire.manage' | 'attendance.manage' | 'appraisals.manage' | 'payroll.run';

export interface Scope {
  level: 'company' | 'department' | 'team' | 'self';
  /** Employee ids whose individual-level records the user may open. */
  people: Set<string>;
  departmentId: string;
  departmentCode: string;
}

export function isExecutive(user: Employee): boolean { return user.functional_role === 'executive' || user.is_admin === 1; }

export function deptCode(db: Db, user: Employee): string {
  return getDepartment(db, user.department_id)?.code || '';
}

/** What the user may see at individual level. Set by "Sees records of" on their role (Settings → Roles and permissions). */
export function scopeFor(db: Db, user: Employee): Scope {
  const code = deptCode(db, user); const level = dataScope(db, user);
  if (level === 'company') return { level: 'company', people: new Set(db.all<{ id: string }>('SELECT id FROM employees').map((r) => r.id)), departmentId: user.department_id, departmentCode: code };
  if (level === 'team') return { level: 'team', people: new Set([user.id, ...subtreeIds(db, user.id)]), departmentId: user.department_id, departmentCode: code };
  return { level: 'self', people: new Set([user.id]), departmentId: user.department_id, departmentCode: code };
}

/** Each action is a module and the least level that allows it. The levels come from the person's role. */
const NEEDS: Record<Action, [ModuleKey, Level]> = {
  'desk.view': ['desk', 'link'], 'desk.write': ['desk', 'work'], 'desk.manage': ['desk', 'manage'], 'dev.write': ['dev', 'work'],
  'sales.view': ['sales', 'link'], 'sales.write': ['sales', 'work'], 'sales.manage': ['sales', 'manage'],
  'production.view': ['production', 'link'], 'production.write': ['production', 'work'],
  'people.view': ['people', 'view'], 'people.admin': ['people', 'manage'], 'settings.admin': ['settings', 'manage'],
  'reports.company': ['company', 'view'], 'reports.export': ['company', 'work'], 'sops.manage': ['sops', 'manage'], 'tasks.assign': ['tasks', 'manage'],
  'hire.manage': ['hire', 'manage'], 'attendance.manage': ['attendance', 'manage'], 'appraisals.manage': ['appraisals', 'manage'], 'payroll.run': ['payroll', 'manage']
};
export function can(db: Db, user: Employee, action: Action): boolean {
  const [module, level] = NEEDS[action];
  if (atLeast(db, user, module, level)) return true;
  // The people named in Settings → Roles as Sales Head and Production HOD keep those rights whatever their role says.
  if (action === 'sales.manage') return user.id === getSetting(db, 'company').salesHeadId;
  if (action === 'production.write') return user.id === getSetting(db, 'company').productionHodId;
  return false;
}

export function requireCan(db: Db, user: Employee, action: Action): void {
  if (!can(db, user, action)) {
    const err = new Error(`You do not have permission for ${action.replace('.', ' ')}.`) as Error & { status?: number };
    err.status = 403;
    throw err;
  }
}

/** True for someone shut out of all the work modules (as HR is to begin with): their search covers people only. */
export function hrRestricted(db: Db, user: Employee): boolean {
  return (['desk', 'sales', 'production'] as ModuleKey[]).every((m) => levelOf(db, user, m) === 'none');
}
