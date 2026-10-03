import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsIn(['CENTRE_ADMIN', 'EDUCATOR', 'PARENT'])
  role!: 'CENTRE_ADMIN' | 'EDUCATOR' | 'PARENT';

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;
}
