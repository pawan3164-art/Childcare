import { IsString, Length, MaxLength } from 'class-validator';

export class RefreshDto {
  @IsString()
  @Length(20, 200)
  refreshToken!: string;
}

export class ConfirmMfaDto {
  @IsString()
  @Length(6, 6)
  code!: string;
}

export class MfaSetupStartDto {
  @IsString()
  @MaxLength(2000)
  setupToken!: string;
}

export class MfaSetupFinishDto {
  @IsString()
  @MaxLength(2000)
  setupToken!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}
