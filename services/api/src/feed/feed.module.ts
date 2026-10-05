import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { LearningModule } from '../learning/learning.module';
import { FeedService } from './feed.service';
import { FeedController } from './feed.controller';

@Module({
  imports: [MediaModule, LearningModule],
  providers: [FeedService],
  controllers: [FeedController],
})
export class FeedModule {}
