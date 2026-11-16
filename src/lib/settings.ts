import type { Db } from '../db/index.ts';
import { DEFAULT_SHIFTS, type Shift } from './time.ts';

export interface SlaRule { response: number; resolve: number; calendar: 'business' | 'always' }
export type SlaMatrix = Record<'P1' | 'P2' | 'P3' | 'P4', SlaRule>;

export interface ApprovalRule { maxAmount?: number; maxPct?: number; maxDays?: number; role: 'self' | 'manager' | 'team_lead' | 'hod' | 'sales_head' | 'coo' | 'ceo' }

export interface PtSlab { upTo: number | null; amount: number }
export interface TaxSlab { upTo: number | null; rate: number }
export interface Statutory {
  verifiedByCa: boolean;
  verifiedNote: string;
  pf: { enabled: boolean; employeeRate: number; employerRate: number; epsRate: number; wageCeiling: number; restrictToCeiling: boolean; adminRate: number; edliRate: number };
  esi: { enabled: boolean; employeeRate: number; employerRate: number; grossCeiling: number };
  pt: { enabled: boolean; state: string; male: PtSlab[]; female: PtSlab[]; februaryExtra: number };
  tds: { enabled: boolean; cessRate: number; new: { standardDeduction: number; slabs: TaxSlab[]; rebateUpTo: number; rebateMax: number }; old: { standardDeduction: number; slabs: TaxSlab[]; rebateUpTo: number; rebateMax: number; limit80c: number; limit80d: number; limit80ccd1b: number } };
}

export interface Settings {
  company: { name: string; shortName: string; currency: string; ceoId: string; cooId: string; salesHeadId: string; hrOwnerId: string; accountsOwnerId: string; productionHodId: string };
  sla: SlaMatrix;
  shifts: Shift[];
  holidays: string[];
  approvals: { expense: ApprovalRule[]; discount: ApprovalRule[]; leave: ApprovalRule[]; purchase: ApprovalRule[] };
  sop: { graceBusinessMinutes: number };
  escalation: { slaWarnPct: number };
  production: { qcEnabled: boolean; defaultLeadTimeDays: number };
  leave: { CL: number; SL: number; PL: number };
  travel: { ratePerKm: number };
  statutory: Statutory;
  payroll: { treatMissingAsPresent: boolean; lateGraceMinutes: number; halfDayAfterMinutes: number; payDay: number };
}

export const DEFAULT_SETTINGS: Settings = {
  company: { name: 'Loyal String', shortName: 'LoyalFlow', currency: 'INR', ceoId: 'LS001', cooId: 'LS002', salesHeadId: 'LS028', hrOwnerId: 'LS003', accountsOwnerId: 'LS006', productionHodId: 'LS006' },
  sla: {
    P1: { response: 15, resolve: 240, calendar: 'always' },
    P2: { response: 60, resolve: 540, calendar: 'business' },
    P3: { response: 240, resolve: 1620, calendar: 'business' },
    P4: { response: 540, resolve: 3780, calendar: 'business' }
  },
  shifts: DEFAULT_SHIFTS,
  holidays: ['2026-11-09', '2026-12-25', '2027-01-26', '2027-03-22', '2027-05-01', '2027-08-15', '2027-10-02'],
  approvals: {
    expense: [{ maxAmount: 10000, role: 'team_lead' }, { maxAmount: 50000, role: 'hod' }, { role: 'coo' }],
    discount: [{ maxPct: 5, role: 'self' }, { maxPct: 10, role: 'sales_head' }, { role: 'coo' }],
    leave: [{ maxDays: 3, role: 'manager' }, { role: 'hod' }],
    purchase: [{ maxAmount: 10000, role: 'team_lead' }, { maxAmount: 50000, role: 'hod' }, { role: 'coo' }]
  },
  sop: { graceBusinessMinutes: 540 },
  escalation: { slaWarnPct: 50 },
  production: { qcEnabled: false, defaultLeadTimeDays: 7 },
  leave: { CL: 12, SL: 6, PL: 15 },
  travel: { ratePerKm: 12 },
  payroll: { treatMissingAsPresent: true, lateGraceMinutes: 15, halfDayAfterMinutes: 240, payDay: 7 },
  statutory: {
    verifiedByCa: false,
    verifiedNote: '',
    pf: { enabled: true, employeeRate: 12, employerRate: 12, epsRate: 8.33, wageCeiling: 15000, restrictToCeiling: true, adminRate: 0.5, edliRate: 0.5 },
    esi: { enabled: true, employeeRate: 0.75, employerRate: 3.25, grossCeiling: 21000 },
    pt: { enabled: true, state: 'Maharashtra',
      male: [{ upTo: 7500, amount: 0 }, { upTo: 10000, amount: 175 }, { upTo: null, amount: 200 }],
      female: [{ upTo: 25000, amount: 0 }, { upTo: null, amount: 200 }],
      februaryExtra: 100 },
    tds: { enabled: true, cessRate: 4,
      new: { standardDeduction: 75000, rebateUpTo: 1200000, rebateMax: 60000,
        slabs: [{ upTo: 400000, rate: 0 }, { upTo: 800000, rate: 5 }, { upTo: 1200000, rate: 10 }, { upTo: 1600000, rate: 15 }, { upTo: 2000000, rate: 20 }, { upTo: 2400000, rate: 25 }, { upTo: null, rate: 30 }] },
      old: { standardDeduction: 50000, rebateUpTo: 500000, rebateMax: 12500, limit80c: 150000, limit80d: 25000, limit80ccd1b: 50000,
        slabs: [{ upTo: 250000, rate: 0 }, { upTo: 500000, rate: 5 }, { upTo: 1000000, rate: 20 }, { upTo: null, rate: 30 }] } }
  }
};

export function getSetting<K extends keyof Settings>(db: Db, key: K): Settings[K] {
  const row = db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) return DEFAULT_SETTINGS[key];
  try {
    const parsed = JSON.parse(row.value);
    if (Array.isArray(DEFAULT_SETTINGS[key])) return (Array.isArray(parsed) ? parsed : DEFAULT_SETTINGS[key]) as Settings[K];
    return { ...(DEFAULT_SETTINGS[key] as object), ...(parsed as object) } as Settings[K];
  } catch { return DEFAULT_SETTINGS[key]; }
}

export function getAllSettings(db: Db): Settings {
  const out = { ...DEFAULT_SETTINGS } as Settings;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) (out as any)[key] = getSetting(db, key);
  return out;
}

export function setSetting<K extends keyof Settings>(db: Db, key: K, value: Settings[K], by: string | null): void {
  db.run('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
    [key, JSON.stringify(value), new Date().toISOString(), by]);
}

export function shiftByCode(db: Db, code: string): Shift {
  const shifts = getSetting(db, 'shifts');
  return shifts.find((s) => s.code === code) || shifts[0];
}

export function holidaySet(db: Db): Set<string> { return new Set(getSetting(db, 'holidays')); }
