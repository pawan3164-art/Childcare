import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePhotoPostDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  caption?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  mediaAssetIds!: string[];
}
