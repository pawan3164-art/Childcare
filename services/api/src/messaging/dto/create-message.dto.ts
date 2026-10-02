import { IsIn, IsOptional, IsString } from 'class-validator';

export class CreateMessageDto {
  @IsIn(['ROOM', 'CENTRE', 'EMERGENCY'])
  scope!: 'ROOM' | 'CENTRE' | 'EMERGENCY';

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsString()
  body!: string;
}
