import { IsDateString, IsIn, IsString } from 'class-validator';

export class RecordAttendanceDto {
  @IsString()
  childId!: string;

  @IsIn(['SIGN_IN', 'SIGN_OUT'])
  eventType!: 'SIGN_IN' | 'SIGN_OUT';

  @IsIn(['KIOSK', 'QR', 'PIN', 'EDUCATOR'])
  method!: 'KIOSK' | 'QR' | 'PIN' | 'EDUCATOR';

  @IsDateString()
  timestamp!: string;
}
