import { APP_INTERCEPTOR } from '@nestjs/core';
import { AUDIT_READ_KEY, AuditReadInterceptor, AuditReadService } from '../../src/audit/audit-read';
import { AuditModule } from '../../src/audit/audit.module';
import { AppModule } from '../../src/app.module';
import { AttendanceController } from '../../src/attendance/attendance.controller';
import { BillingController } from '../../src/billing/billing.controller';
import { CareRecordsController } from '../../src/care-records/care-records.controller';
import { ChildrenController } from '../../src/centre-admin/children.controller';
import { DashboardController } from '../../src/dashboard/dashboard.controller';
import { FamilyRequestsController } from '../../src/family-requests/family-requests.controller';
import { FeedController } from '../../src/feed/feed.controller';
import { GuardianRelationshipsController } from '../../src/guardian-relationships/guardian-relationships.controller';
import { IncidentsController } from '../../src/incidents/incidents.controller';
import { LearningController } from '../../src/learning/learning.controller';
import { MediaController } from '../../src/media/media.controller';
import { MedicationController } from '../../src/medication/medication.controller';
import { DirectMessagesController } from '../../src/messaging/direct-messages.controller';

/** OI-18: sensitive GET routes must carry @AuditRead with the agreed values. */
type Row = [string, any, string, string, string | null, string | null];
const rows: Row[] = [
  ['GET children/:childId/attendance', AttendanceController, 'history', 'attendance', 'Child', 'childId'],
  ['GET children/:childId/care-records', CareRecordsController, 'history', 'care_records', 'Child', 'childId'],
  ['GET children/:childId/at-a-glance', DashboardController, 'getChildAtAGlance', 'child_at_a_glance', 'Child', 'childId'],
  ['GET children/:childId/feed', FeedController, 'childFeed', 'child_feed', 'Child', 'childId'],
  ['GET children/:childId/timeline', FeedController, 'childTimeline', 'child_timeline', 'Child', 'childId'],
  ['GET children/:childId/portfolio', LearningController, 'portfolio', 'learning_portfolio', 'Child', 'childId'],
  ['GET learning/records/:id', LearningController, 'get', 'learning_record', 'LearningRecord', 'id'],
  ['GET children/:childId/ledger', BillingController, 'getLedger', 'child_ledger', 'Child', 'childId'],
  ['GET medication/authorizations', MedicationController, 'listAuthorizations', 'medication_authorizations', null, null],
  ['GET medication/administrations', MedicationController, 'listAdministrations', 'medication_administrations', null, null],
  ['GET incidents', IncidentsController, 'list', 'incidents', null, null],
  ['GET media/:mediaAssetId/url', MediaController, 'viewUrl', 'media_view', 'MediaAsset', 'mediaAssetId'],
  ['GET conversations/:threadId', DirectMessagesController, 'get', 'conversation', 'DirectThread', 'threadId'],
  ['GET guardian-relationships', GuardianRelationshipsController, 'listForChild', 'guardian_relationships', null, null],
  ['GET children', ChildrenController, 'list', 'children_list', null, null],
  ['GET children/:childId/absences', FamilyRequestsController, 'listAbsences', 'absences', 'Child', 'childId'],
  ['GET children/:childId/casual-day-requests', FamilyRequestsController, 'listCasualDayRequests', 'casual_day_requests', 'Child', 'childId'],
  ['GET children/:childId/pickup-nominations', FamilyRequestsController, 'listPickupNominations', 'pickup_nominations', 'Child', 'childId'],
  ['GET absences', FamilyRequestsController, 'listCentreAbsences', 'absences_centre', null, null],
  ['GET casual-day-requests', FamilyRequestsController, 'listPendingCasualDayRequests', 'casual_day_requests_pending', null, null],
  ['GET pickup-nominations', FamilyRequestsController, 'listPickupsForDate', 'pickup_nominations_for_date', null, null],
];

describe('OI-18 audit-read coverage', () => {
  it.each(rows)('%s is decorated', (_route, controller, method, resource, entityType, idParam) => {
    expect(typeof controller.prototype[method]).toBe('function');
    expect(Reflect.getMetadata(AUDIT_READ_KEY, controller.prototype[method])).toEqual({ resource, entityType, idParam });
  });

  it('AppModule registers AuditReadInterceptor as APP_INTERCEPTOR', () => {
    const providers: any[] = Reflect.getMetadata('providers', AppModule) ?? [];
    expect(providers).toContainEqual({ provide: APP_INTERCEPTOR, useClass: AuditReadInterceptor });
  });

  it('AuditModule exports AuditReadService (and provides it)', () => {
    expect(Reflect.getMetadata('exports', AuditModule)).toContain(AuditReadService);
    expect(Reflect.getMetadata('providers', AuditModule)).toContain(AuditReadService);
  });
});
