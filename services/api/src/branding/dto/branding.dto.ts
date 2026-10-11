import { IsOptional, IsString, MaxLength } from 'class-validator';

// Lengths here are loose on purpose: the service enforces the real limits and returns clear messages.
export class UpdateBrandDto {
  @IsString()
  @MaxLength(500)
  displayName!: string;

  @IsString()
  @MaxLength(50)
  primaryColor!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  welcomeMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  philosophy?: string;
}

export class AddDomainDto {
  @IsString()
  @MaxLength(500)
  hostname!: string;
}
