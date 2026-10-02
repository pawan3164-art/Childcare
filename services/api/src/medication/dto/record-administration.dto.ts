import { IsDateString, IsOptional, IsString } from 'class-validator';

export class RecordAdministrationDto {
  @IsString()
  authorizationId!: string;

  @IsDateString()
  administeredAt!: string;

  @IsString()
  dosageGiven!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
