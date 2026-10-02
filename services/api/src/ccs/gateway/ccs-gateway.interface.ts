export interface CcsGatewaySubmission {
  ccsEnrolmentRef: string;
  sessionDate: Date;
  hours: number;
}

export interface CcsGatewayResponse {
  accepted: boolean;
  providerResponseRef: string;
  /** Confirmed subsidy as a percentage of the session fee. Real Services
   * Australia responses don't work this way (hourly rate caps, activity test,
   * withholding — see OI-13); this is a stand-in shape sufficient to exercise
   * the ledger's estimated-vs-confirmed netting end to end. */
  confirmedSubsidyPercent?: number;
  rejectionReason?: string;
}

/**
 * Delivery Plan R4: "Isolated module with its own queue, retries, audit
 * trail and replay tool, so a government outage can never block care
 * workflows." This interface is the isolation boundary — nothing else in
 * the codebase talks to Services Australia directly, only through here, so
 * swapping MockCcsGateway for a real registered-software integration later
 * touches one binding (ccs.module.ts), not call sites.
 */
export interface CcsGateway {
  submitSessionReport(input: CcsGatewaySubmission): Promise<CcsGatewayResponse>;
}

export const CCS_GATEWAY = Symbol('CCS_GATEWAY');
