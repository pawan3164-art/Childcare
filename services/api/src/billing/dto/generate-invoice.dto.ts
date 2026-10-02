import { IsDateString, IsString } from 'class-validator';

export class GenerateInvoiceDto {
  @IsString()
  childId!: string;

  @IsDateString()
  cycleStart!: string;

  @IsDateString()
  cycleEnd!: string;
}
