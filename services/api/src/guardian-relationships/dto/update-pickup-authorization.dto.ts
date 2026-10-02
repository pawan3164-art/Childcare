import { IsBoolean, IsDateString, IsOptional } from 'class-validator';

export class UpdatePickupAuthorizationDto {
  @IsBoolean()
  canPickup!: boolean;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
