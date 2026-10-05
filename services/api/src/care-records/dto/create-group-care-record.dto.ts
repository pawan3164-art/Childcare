import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export const CARE_RECORD_TYPES = ['MEAL', 'SLEEP', 'TOILETING', 'BOTTLE', 'ACTIVITY', 'NAPPY', 'SUNSCREEN', 'SLEEP_CHECK'] as const;

export class CareRecordExceptionDto {
  @IsString()
  childId!: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsBoolean()
  skip?: boolean;

  /** Overrides defaultDetails for this child (e.g. one SOILED nappy in a WET group). */
  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;
}

/**
 * BRD §9 group-first workflow: "an educator can record a common event once
 * and then apply exceptions to individual children." childIds is the full
 * room/group roster for this event; exceptions overrides (or skips) specific
 * children instead of requiring them to be re-entered individually.
 */
export class CreateGroupCareRecordDto {
  @IsIn(CARE_RECORD_TYPES)
  type!: (typeof CARE_RECORD_TYPES)[number];

  @IsDateString()
  timestamp!: string;

  @IsOptional()
  @IsString()
  defaultNote?: string;

  /** Structured details for every child; see care-details.ts for each type's shape. */
  @IsOptional()
  @IsObject()
  defaultDetails?: Record<string, unknown>;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  childIds!: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CareRecordExceptionDto)
  exceptions?: CareRecordExceptionDto[];
}
