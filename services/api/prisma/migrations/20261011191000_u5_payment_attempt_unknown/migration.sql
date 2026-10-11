-- A charge whose outcome we could not confirm (gateway timeout or error, or a failure while recording it).
-- It is neither paid nor failed until it is reconciled with the gateway.
ALTER TYPE "PaymentAttemptStatus" ADD VALUE 'UNKNOWN';
