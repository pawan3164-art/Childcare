import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class CreateRelationshipDto {
  @IsString()
  guardianUserId!: string;

  @IsString()
  childId!: string;

  @IsIn(['PARENT', 'GUARDIAN', 'AUTHORIZED_PICKUP'])
  relationshipType!: 'PARENT' | 'GUARDIAN' | 'AUTHORIZED_PICKUP';

  @IsOptional()
  @IsBoolean()
  canViewMedia?: boolean;

  @IsOptional()
  @IsBoolean()
  canViewBilling?: boolean;

  @IsOptional()
  @IsBoolean()
  canPickup?: boolean;
}
