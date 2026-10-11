import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class SetModuleDto {
  @IsBoolean()
  enabled!: boolean;
}

export class SetPlanDto {
  @IsString()
  @MaxLength(50)
  plan!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  validUntil?: string | null;
}
