import { IsString, MaxLength } from 'class-validator';

export class DirectMessageDto {
  @IsString()
  @MaxLength(4000)
  body!: string;
}
