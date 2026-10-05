import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateMessageDto {
  @IsIn(['ROOM', 'CENTRE', 'EMERGENCY'])
  scope!: 'ROOM' | 'CENTRE' | 'EMERGENCY';

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsString()
  @MaxLength(4000)
  body!: string;
}
