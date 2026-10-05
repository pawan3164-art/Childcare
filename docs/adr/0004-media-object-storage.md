# ADR 0004: Media object storage

- Status: Accepted (resolves OI-09)
- Date: 2026-10-05

## Context

BRD §17 requires private media storage with short-lived access, no public URLs, and EXIF/GPS metadata stripped before anything is stored. Stage 1 built and tested the access rule (`MediaService.canView`: a multi-child photo is visible to a family only if every tagged child's permissions allow it) but treats `storageKey` as an opaque string; no file bytes are handled. Stage U1 (family feed, photo posts) needs real uploads. All personal data must stay in Australian regions (BRD §18).

## Decision

- Put object storage behind an internal `ObjectStorage` interface (put, signed GET URL, delete) so the provider is a single binding, the same pattern as the CCS and payment gateways.
- Deployed environments use **AWS S3 in ap-southeast-2** (DR replica in ap-southeast-4), with private buckets, Block Public Access on, and SSE-KMS encryption.
- Local development uses **MinIO** in `infra/docker-compose.dev.yml`. It speaks the S3 API, so the same S3 client code runs locally with real bytes and real presigned URLs.
- Uploads go through the API, not directly from the device to the bucket. The API checks the caller can tag every named child, re-encodes images with `sharp` (which drops EXIF, GPS and other metadata by default), stores the result under an unguessable key, and records the asset. Direct-to-bucket presigned uploads can be added later for large videos, followed by a server-side processing worker.
- Reads: the client asks the API for a view URL; the API runs `canView` and then returns a presigned GET URL valid for **5 minutes**. Every view of child media is audit-logged.
- Videos are stored as uploaded in U1 (metadata stripping for video needs a transcoding worker, e.g. ffmpeg). Until that worker exists, video upload stays behind a feature flag and off by default.

## Consequences

- Real media works end to end locally without an AWS account.
- MinIO adds one container (about 100 MB of memory) to the dev stack, which matters on this memory-constrained machine.
- `sharp` is a native dependency; CI images need its prebuilt binaries.
- Signed URLs can be shared within their 5-minute window. That is accepted for now (BRD §17 asks for short-lived access, not single-use), and can be tightened later by streaming bytes through the API.
