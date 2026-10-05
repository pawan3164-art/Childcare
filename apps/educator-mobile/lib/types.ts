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

export type CareRecordType = 'MEAL' | 'SLEEP' | 'TOILETING' | 'BOTTLE' | 'ACTIVITY';
