import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateAuthorizationDto {
  @IsString()
  childId!: string;

  @IsString()
  medicationName!: string;

  @IsString()
  dosageInstructions!: string;

  @IsString()
  authorizedByGuardianId!: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
