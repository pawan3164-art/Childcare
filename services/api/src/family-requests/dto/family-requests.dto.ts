import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'date must be YYYY-MM-DD';

export class ReportAbsenceDto {
  @Matches(DATE, { message: DATE_MESSAGE })
  date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class SetAbsenceAllowableDto {
  @IsBoolean()
  isAllowable!: boolean;
}

export class RequestCasualDayDto {
  @Matches(DATE, { message: DATE_MESSAGE })
  date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ApproveCasualDayDto {
  @IsOptional()
  @IsString()
  feeScheduleId?: string;
}

export class DeclineCasualDayDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class NominatePickupDto {
  @Matches(DATE, { message: DATE_MESSAGE })
  date!: string;

  @IsString()
  @MaxLength(100)
  personName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  personPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
