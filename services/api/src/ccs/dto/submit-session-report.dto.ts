import { IsDateString, IsNumber, IsPositive, IsString } from 'class-validator';

export class SubmitSessionReportDto {
  @IsString()
  enrolmentId!: string;

  @IsDateString()
  sessionDate!: string;

  @IsNumber()
  @IsPositive()
  hours!: number;
}
