import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateRoomDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  ageBandMinMonths?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  ageBandMaxMonths?: number;
}
