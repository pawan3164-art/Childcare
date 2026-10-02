import { IsDateString, IsIn, IsString } from 'class-validator';

export class CreateIncidentDto {
  @IsString()
  childId!: string;

  @IsIn(['MINOR', 'MODERATE', 'SERIOUS'])
  severity!: 'MINOR' | 'MODERATE' | 'SERIOUS';

  @IsString()
  description!: string;

  @IsDateString()
  occurredAt!: string;
}
