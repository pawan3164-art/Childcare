import { IsDateString, IsIn, IsObject, IsString } from 'class-validator';

export class SubmitOperationDto {
  @IsString()
  idempotencyKey!: string;

  @IsString()
  clientOperationId!: string;

  @IsString()
  entityType!: string;

  @IsString()
  entityId!: string;

  @IsIn(['CREATE', 'UPDATE', 'DELETE'])
  operationType!: 'CREATE' | 'UPDATE' | 'DELETE';

  @IsObject()
  payload!: Record<string, unknown>;

  @IsDateString()
  clientTimestamp!: string;
}
