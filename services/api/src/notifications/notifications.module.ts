import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PUSH_PROVIDER } from './providers/push-provider.interface';
import { StubPushProvider } from './providers/stub-push.provider';

@Module({
  providers: [
    NotificationsService,
    { provide: PUSH_PROVIDER, useClass: StubPushProvider },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
