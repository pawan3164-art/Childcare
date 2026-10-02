import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PushProvider, PushSendResult } from './push-provider.interface';

/**
 * No real APNs/FCM credentials exist yet. This stub always "succeeds" so the
 * rest of the pipeline (queue -> send -> delivery receipt -> retry ->
 * fallback) can be built and tested end-to-end before a real provider is
 * wired in — swap this binding in notifications.module.ts when ready.
 */
@Injectable()
export class StubPushProvider implements PushProvider {
  private readonly logger = new Logger(StubPushProvider.name);

  async send(recipientUserId: string, payload: Record<string, unknown>): Promise<PushSendResult> {
    this.logger.log({ recipientUserId, payload }, 'stub push send');
    return { providerMessageId: uuidv4(), sent: true };
  }
}
