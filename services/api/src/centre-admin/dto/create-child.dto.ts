import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateChildDto {
  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsDateString()
  dateOfBirth!: string;

  @IsOptional()
  @IsString()
  roomId?: string;
}
