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

export type CareRecordType = 'MEAL' | 'SLEEP' | 'TOILETING' | 'BOTTLE' | 'ACTIVITY' | 'NAPPY' | 'SUNSCREEN' | 'SLEEP_CHECK';

export interface ThreadSummary {
  id: string;
  childId: string;
  childFirstName: string;
  recipients: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  unread: number;
}

export interface ThreadView extends ThreadSummary {
  messages: { id: string; body: string; createdAt: string; fromStaff: boolean; author: { firstName: string } }[];
}

export type ChecklistResult = 'PASS' | 'FAIL' | 'NA';

export interface ChecklistTemplate {
  id: string;
  name: string;
  roomId: string | null;
  items: { id: string; label: string }[];
}

export interface RoomChecklist {
  template: ChecklistTemplate;
  lastCompletion: { id: string; completedAt: string; completedBy: { firstName: string }; failedCount: number } | null;
}

export interface SleepStatus {
  childId: string;
  sleepingSince: string;
  lastCheckAt: string | null;
  nextCheckDueAt: string;
  overdue: boolean;
  /** The centre's sleep-check interval in minutes. */
  intervalMinutes: number;
}
