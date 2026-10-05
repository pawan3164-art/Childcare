import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class CreateChecklistTemplateDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  /** Omit for a checklist that applies to every room in the centre. */
  @IsOptional()
  @IsString()
  roomId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  items!: string[];
}

export class ChecklistResultDto {
  @IsString()
  itemId!: string;

  @IsIn(['PASS', 'FAIL', 'NA'])
  result!: 'PASS' | 'FAIL' | 'NA';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class CompleteChecklistDto {
  /** Client-generated id (UUID) so a retried submit is stored once. */
  @IsString()
  id!: string;

  @IsString()
  templateId!: string;

  @IsString()
  roomId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChecklistResultDto)
  results!: ChecklistResultDto[];
}
