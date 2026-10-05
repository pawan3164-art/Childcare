-- AlterTable
ALTER TABLE "centres" ADD COLUMN     "sleep_check_interval_minutes" INTEGER NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "staff_room_assignments" ADD COLUMN     "is_lead" BOOLEAN NOT NULL DEFAULT false;

-- Same bounds the service enforces, so no path can set an unsafe interval.
ALTER TABLE "centres" ADD CONSTRAINT "centres_sleep_check_interval_range" CHECK (sleep_check_interval_minutes BETWEEN 5 AND 30);
