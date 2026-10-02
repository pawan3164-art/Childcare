import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class CareRecordExceptionDto {
  @IsString()
  childId!: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsBoolean()
  skip?: boolean;
}

/**
 * BRD §9 group-first workflow: "an educator can record a common event once
 * and then apply exceptions to individual children." childIds is the full
 * room/group roster for this event; exceptions overrides (or skips) specific
 * children instead of requiring them to be re-entered individually.
 */
export class CreateGroupCareRecordDto {
  @IsIn(['MEAL', 'SLEEP', 'TOILETING', 'BOTTLE', 'ACTIVITY'])
  type!: 'MEAL' | 'SLEEP' | 'TOILETING' | 'BOTTLE' | 'ACTIVITY';

  @IsDateString()
  timestamp!: string;

  @IsOptional()
  @IsString()
  defaultNote?: string;

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
