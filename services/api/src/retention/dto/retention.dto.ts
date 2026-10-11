import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class DepartChildDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;
}

export class LegalHoldDto {
  @IsBoolean()
  hold!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class RetentionOverrideDto {
  @IsInt()
  years!: number;
}
