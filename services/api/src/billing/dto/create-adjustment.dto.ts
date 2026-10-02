import { IsIn, IsInt, IsString } from 'class-validator';

export class CreateAdjustmentDto {
  @IsString()
  childId!: string;

  @IsIn(['ADJUSTMENT', 'CREDIT'])
  entryType!: 'ADJUSTMENT' | 'CREDIT';

  /** For ADJUSTMENT: signed (positive increases balance owed, negative decreases it).
   *  For CREDIT: magnitude only — always reduces balance regardless of sign given. */
  @IsInt()
  amountCents!: number;

  @IsString()
  reasonCode!: string;

  @IsString()
  description!: string;
}
