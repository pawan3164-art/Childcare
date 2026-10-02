import { IsString } from 'class-validator';

export class CreateEnrolmentDto {
  @IsString()
  childId!: string;

  @IsString()
  ccsEnrolmentRef!: string;
}
