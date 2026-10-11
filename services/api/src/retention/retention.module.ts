import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service';
import { RetentionController } from './retention.controller';

@Module({ providers: [RetentionService], controllers: [RetentionController], exports: [RetentionService] })
export class RetentionModule {}
