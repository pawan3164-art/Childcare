export interface PushSendResult {
  providerMessageId: string;
  sent: boolean;
}

/**
 * Abstraction over APNs/FCM (BRD §21 Push Notifications). The real
 * integration is deferred — Stage 0 only needs the queue and tracking model
 * in place. Swap StubPushProvider for a real implementation behind this
 * interface; nothing else in the notifications module should need to change.
 */
export interface PushProvider {
  send(recipientUserId: string, payload: Record<string, unknown>): Promise<PushSendResult>;
}

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');
