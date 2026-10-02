import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { CcsGateway, CcsGatewayResponse, CcsGatewaySubmission } from './ccs-gateway.interface';

/**
 * No real Services Australia registration exists yet (OI-05) — this stands
 * in so the rest of the pipeline (submit -> record response -> confirmed
 * ledger entry -> rejection/resubmission) can be built and tested now.
 * Rejection rule is deliberately arbitrary (Sunday sessions), not a real CCS
 * rule, purely to give rejection/resubmission a deterministic trigger in tests.
 */
@Injectable()
export class MockCcsGateway implements CcsGateway {
  private readonly logger = new Logger(MockCcsGateway.name);

  async submitSessionReport(input: CcsGatewaySubmission): Promise<CcsGatewayResponse> {
    this.logger.log({ input }, 'mock CCS session report submission');

    if (input.sessionDate.getUTCDay() === 0) {
      return {
        accepted: false,
        providerResponseRef: uuidv4(),
        rejectionReason: 'mock_gateway: no entitlement recorded for this date',
      };
    }

    return {
      accepted: true,
      providerResponseRef: uuidv4(),
      confirmedSubsidyPercent: 70,
    };
  }
}
