# ADR 0004: Media object storage

- Status: Accepted (resolves OI-09)
- Date: 2026-10-05

## Context

BRD §17 requires private media storage with short-lived access, no public URLs, and EXIF/GPS metadata stripped before anything is stored. Stage 1 built and tested the access rule (`MediaService.canView`: a multi-child photo is visible to a family only if every tagged child's permissions allow it) but treats `storageKey` as an opaque string; no file bytes are handled. Stage U1 (family feed, photo posts) needs real uploads. All personal data must stay in Australian regions (BRD §18).

## Decision

- Put object storage behind an internal `ObjectStorage` interface (put, signed GET URL, delete) so the provider is a single binding, the same pattern as the CCS and payment gateways.
- Deployed environments use **AWS S3 in ap-southeast-2** (DR replica in ap-southeast-4), with private buckets, Block Public Access on, and SSE-KMS encryption.
- Local development uses **SeaweedFS's S3 gateway** in `infra/docker-compose.dev.yml` (port 59000), with request signing enforced by `infra/seaweedfs/s3.json`. MinIO was the first choice, but its Docker images are no longer publicly published. Any S3-compatible server works; the same S3 client code runs locally with real bytes and real presigned URLs. Create the bucket with `npm run storage:init`.
- Uploads go through the API, not directly from the device to the bucket. The API checks the caller can tag every named child, re-encodes images with `sharp` (which drops EXIF, GPS and other metadata by default), stores the result under an unguessable key, and records the asset. Direct-to-bucket presigned uploads can be added later for large videos, followed by a server-side processing worker.
- Reads: the client asks the API for a view URL; the API runs `canView` and then returns a presigned GET URL valid for **5 minutes**. Every view of child media is audit-logged.
- Only JPEG, PNG and WebP photos are accepted (stored as JPEG, longest edge 2560px). HEIC is not accepted because sharp's prebuilt binaries cannot decode it; the apps convert to JPEG before upload. Video is not accepted yet: stripping video metadata needs a transcoding worker (e.g. ffmpeg).

## Group photos and consent (added during U1)

A photo tagging several children is visible to a parent only if (a) they may view media for at least one tagged child of their own, (b) they are not denied media for any tagged child they have a relationship with, including restricted ones, and (c) **every other tagged child has group-photo consent** from their family. Consent is a field on the child, **off by default**, settable by an unrestricted guardian or recorded by a centre admin, and every change is audit-logged. Before this, a group photo was visible only to a parent who was guardian of every tagged child, so in practice no family saw group photos.

**Learning stories (U2, decided 2026-10-05, OI-24):** the same group-consent flag also governs group learning stories and observations. A family sees a learning record that tags other children only under rule (c) above; their own child's record is always visible to them. One flag covers photos and text.

## Consequences

- Real media works end to end locally without an AWS account.
- The S3 container adds roughly 100 MB of memory to the dev stack, which matters on this memory-constrained machine.
- `sharp` is a native dependency; CI images need its prebuilt binaries.
- Signed URLs can be shared within their 5-minute window. That is accepted for now (BRD §17 asks for short-lived access, not single-use), and can be tightened later by streaming bytes through the API.
