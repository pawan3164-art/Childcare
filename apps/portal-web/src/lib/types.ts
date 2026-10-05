export type UserRole = 'PLATFORM_ADMIN' | 'ORG_ADMIN' | 'CENTRE_ADMIN' | 'EDUCATOR' | 'PARENT';

export interface UserProfile {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  orgId: string | null;
  orgName: string | null;
  centreId: string | null;
  centreName: string | null;
  mfaEnabled: boolean;
}

export interface Room {
  id: string;
  name: string;
  ageBandMin: number | null;
  ageBandMax: number | null;
}

export type AttendanceStatus = 'SIGNED_IN' | 'SIGNED_OUT' | 'NO_EVENTS_TODAY';

export interface ChildListItem {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  roomId: string | null;
  roomName: string | null;
  attendanceStatus: AttendanceStatus;
  previousDayNotSignedOut: boolean;
}

export interface ChildAtAGlance {
  child: { id: string; firstName: string; lastName: string; roomName: string | null };
  attendance: { status: AttendanceStatus; lastEventAt: string | null; previousDayNotSignedOut: boolean };
  todaysCareRecords: { type: string; timestamp: string; note: string | null }[];
}

export interface LedgerBreakdown {
  grossCents: number;
  subsidyCents: number;
  paymentsCents: number;
  adjustmentsCents: number;
  creditsCents: number;
  balanceCents: number;
}

export type IncidentSeverity = 'MINOR' | 'MODERATE' | 'SERIOUS';
export type IncidentReviewStatus = 'OPEN' | 'ACKNOWLEDGED' | 'REVIEWED';

export interface IncidentListItem {
  id: string;
  severity: IncidentSeverity;
  description: string;
  occurredAt: string;
  reviewStatus: IncidentReviewStatus;
  child: { firstName: string; lastName: string };
}

export type MedicationAdministrationStatus = 'CONFIRMED' | 'PENDING_REVIEW' | 'REJECTED';

export interface MedicationAdministrationListItem {
  id: string;
  administeredAt: string;
  dosageGiven: string;
  status: MedicationAdministrationStatus;
  authorization: {
    medicationName: string;
    child: { firstName: string; lastName: string };
  };
}

export interface MedicationAuthorization {
  id: string;
  medicationName: string;
  dosageInstructions: string;
  expiresAt: string | null;
}

export type CareRecordType = 'MEAL' | 'SLEEP' | 'TOILETING' | 'BOTTLE' | 'ACTIVITY';
