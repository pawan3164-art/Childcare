import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { FeedService } from './feed.service';
import { FeedController } from './feed.controller';

@Module({
  imports: [MediaModule],
  providers: [FeedService],
  controllers: [FeedController],
})
export class FeedModule {}
