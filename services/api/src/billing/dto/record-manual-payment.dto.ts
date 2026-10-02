import { IsInt, IsPositive, IsString } from 'class-validator';

export class RecordManualPaymentDto {
  @IsString()
  childId!: string;

  @IsInt()
  @IsPositive()
  amountCents!: number;

  @IsString()
  method!: string; // e.g. "bank_transfer", "cash"
}
