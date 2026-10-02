import { IsString, Length } from 'class-validator';

export class VerifyMfaDto {
  @IsString()
  mfaToken!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}
