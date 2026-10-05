import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class SaveLearningDraftDto {
  @IsString()
  roomId!: string;

  @IsIn(['OBSERVATION', 'LEARNING_STORY'])
  kind!: 'OBSERVATION' | 'LEARNING_STORY';

  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(10000) observation?: string;
  @IsOptional() @IsString() @MaxLength(10000) interpretation?: string;
  @IsOptional() @IsString() @MaxLength(10000) reflection?: string;
  @IsOptional() @IsString() @MaxLength(10000) nextSteps?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(19) @IsString({ each: true }) outcomes?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) childIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) mediaAssetIds?: string[];
}

export class AmendLearningDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(10000) observation?: string;
  @IsOptional() @IsString() @MaxLength(10000) interpretation?: string;
  @IsOptional() @IsString() @MaxLength(10000) reflection?: string;
  @IsOptional() @IsString() @MaxLength(10000) nextSteps?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(19) @IsString({ each: true }) outcomes?: string[];
}

export class ReturnLearningDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
