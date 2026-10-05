import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { FeedService } from './feed.service';
import { CreatePhotoPostDto } from './dto/create-photo-post.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Post('feed/posts')
  createPhotoPost(@Req() req: { user: RequestUser }, @Body() dto: CreatePhotoPostDto) {
    return this.feed.createPhotoPost(req.user, dto);
  }

  @Get('children/:childId/feed')
  childFeed(
    @Req() req: { user: RequestUser },
    @Param('childId') childId: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.feed.childFeed(req.user, childId, { before, limit: limit ? Number(limit) : undefined });
  }

  @Get('children/:childId/timeline')
  childTimeline(@Req() req: { user: RequestUser }, @Param('childId') childId: string, @Query('date') date?: string) {
    return this.feed.childTimeline(req.user, childId, date);
  }
}
