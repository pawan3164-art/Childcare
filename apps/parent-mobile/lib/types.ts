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

export type CareRecordType = 'MEAL' | 'SLEEP' | 'TOILETING' | 'BOTTLE' | 'ACTIVITY' | 'NAPPY' | 'SUNSCREEN' | 'SLEEP_CHECK';

export type AnnouncementScope = 'ROOM' | 'CENTRE' | 'EMERGENCY';

export interface AnnouncementSummary {
  id: string;
  scope: AnnouncementScope;
  roomId: string | null;
  body: string;
  createdAt: string;
  author: { firstName: string };
  acknowledgedCount: number;
}

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

export interface FeedMedia {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
}

export type FeedItem =
  | { kind: 'PHOTO_POST'; id: string; createdAt: string; caption: string | null; author: { firstName: string }; media: FeedMedia[] }
  | { kind: 'ANNOUNCEMENT'; id: string; createdAt: string; scope: AnnouncementScope; body: string; author: { firstName: string }; acknowledged: boolean }
  | ({ kind: 'LEARNING'; createdAt: string; recordKind: LearningKind } & Pick<
      LearningRecordView,
      'id' | 'title' | 'observation' | 'interpretation' | 'outcomes' | 'nextSteps' | 'children' | 'author' | 'media'
    >);

export type TimelineEntry =
  | { kind: 'ATTENDANCE'; id: string; at: string; eventType: 'SIGN_IN' | 'SIGN_OUT' }
  | { kind: 'CARE_RECORD'; id: string; at: string; type: CareRecordType; note: string | null; details: Record<string, unknown> | null }
  | { kind: 'PHOTO_POST'; id: string; at: string; caption: string | null; media: FeedMedia[] };

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

export interface ChecklistCompletion {
  id: string;
  templateId: string;
  templateName: string;
  roomId: string;
  completedAt: string;
  completedBy: { firstName: string };
  failedCount: number;
  results: { itemId: string; label: string; result: ChecklistResult; note?: string }[];
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

export type LearningKind = 'OBSERVATION' | 'LEARNING_STORY';
export type LearningStatus = 'DRAFT' | 'IN_REVIEW' | 'PUBLISHED';

export interface EylfOutcome {
  code: string;
  outcome: number;
  outcomeTitle: string;
  label: string;
}

export interface LearningRecordView {
  id: string;
  kind: LearningKind;
  status: LearningStatus;
  roomId: string;
  title: string;
  observation: string;
  interpretation: string | null;
  outcomes: { code: string; label: string; outcomeTitle: string }[];
  reflection?: string | null;
  nextSteps: string | null;
  children: { id: string; firstName: string }[];
  media: { id: string; url: string }[];
  author: { firstName: string };
  publishedAt: string | null;
  version: number;
  updatedAt: string;
  permissions: { edit: boolean; review: boolean; amend: boolean };
  history: { action: string; at: string; actor: { firstName: string }; note: string | null; snapshot: Record<string, unknown> }[];
}

export interface LearningSummary {
  id: string;
  kind: LearningKind;
  status: LearningStatus;
  title: string;
  roomId: string;
  outcomes: string[];
  childIds: string[];
  authorUserId: string;
  createdAt: string;
  publishedAt: string | null;
}

export interface TimelineResponse {
  date: string;
  entries: TimelineEntry[];
}

export interface FeedResponse {
  items: FeedItem[];
  nextBefore: string | null;
}
