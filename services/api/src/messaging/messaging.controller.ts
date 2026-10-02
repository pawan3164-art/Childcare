import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { MessagingService } from './messaging.service';
import { CreateMessageDto } from './dto/create-message.dto';

@UseGuards(JwtAuthGuard)
@Controller('messages')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Post()
  send(@Req() req: { user: RequestUser }, @Body() dto: CreateMessageDto) {
    return this.messaging.send(req.user, dto);
  }

  @Post(':messageId/acknowledge')
  acknowledge(@Req() req: { user: RequestUser }, @Param('messageId') messageId: string) {
    return this.messaging.acknowledge(req.user, messageId);
  }
}
