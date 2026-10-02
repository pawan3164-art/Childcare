import { ArrayMinSize, IsArray, IsOptional, IsString } from 'class-validator';

/**
 * Stage 1 scope: registers metadata for a photo/video that has already been
 * uploaded to storage. Actual file upload handling (multer, EXIF/GPS
 * stripping, private-bucket signed URLs — BRD §17, Delivery Plan R1) is not
 * implemented yet; storageKey is treated as an opaque pointer. Tracked as a
 * follow-on in docs/open-items.md. What IS implemented and tested here is the
 * part with real access-control risk: the per-child tag and the "every
 * tagged child's permission must allow it" visibility rule.
 */
export class RegisterMediaDto {
  @IsString()
  storageKey!: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  childIds!: string[];
}
