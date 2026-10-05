import { IsBoolean } from 'class-validator';

export class GroupPhotoConsentDto {
  @IsBoolean()
  consent!: boolean;
}
