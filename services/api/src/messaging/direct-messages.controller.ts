import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { DirectMessagesService } from './direct-messages.service';
import { DirectMessageDto } from './dto/direct-message.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class DirectMessagesController {
  constructor(private readonly messages: DirectMessagesService) {}

  @Get('conversations')
  list(@Req() req: { user: RequestUser }) {
    return this.messages.listThreads(req.user);
  }

  @Get('conversations/:threadId')
  get(@Req() req: { user: RequestUser }, @Param('threadId') threadId: string) {
    return this.messages.getThread(req.user, threadId);
  }

  /** Guardian writes to their child's room; starts the thread on first use. */
  @Post('children/:childId/conversation')
  sendFromGuardian(@Req() req: { user: RequestUser }, @Param('childId') childId: string, @Body() dto: DirectMessageDto) {
    return this.messages.sendFromGuardian(req.user, childId, dto.body);
  }

  @Post('conversations/:threadId/reply')
  reply(@Req() req: { user: RequestUser }, @Param('threadId') threadId: string, @Body() dto: DirectMessageDto) {
    return this.messages.reply(req.user, threadId, dto.body);
  }
}
