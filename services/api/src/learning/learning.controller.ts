import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { LearningRecordStatus } from '@prisma/client';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { LearningService } from './learning.service';
import { EYLF_OUTCOMES } from './eylf';
import { AmendLearningDto, ReturnLearningDto, SaveLearningDraftDto } from './dto/learning.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class LearningController {
  constructor(private readonly learning: LearningService) {}

  @Get('learning/outcomes')
  outcomes() {
    return EYLF_OUTCOMES;
  }

  @Get('learning/records')
  search(
    @Req() req: { user: RequestUser },
    @Query('roomId') roomId?: string,
    @Query('childId') childId?: string,
    @Query('outcome') outcome?: string,
    @Query('authorId') authorId?: string,
    @Query('status') status?: LearningRecordStatus,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.learning.search(req.user, { roomId, childId, outcome, authorId, status, from, to });
  }

  @Get('learning/records/:id')
  get(@Req() req: { user: RequestUser }, @Param('id') id: string) {
    return this.learning.get(req.user, id);
  }

  /** Auto-save: the client generates the id and PUTs the whole draft each time. */
  @Put('learning/records/:id')
  saveDraft(@Req() req: { user: RequestUser }, @Param('id') id: string, @Body() dto: SaveLearningDraftDto) {
    return this.learning.saveDraft(req.user, { ...dto, id });
  }

  @Post('learning/records/:id/submit')
  submit(@Req() req: { user: RequestUser }, @Param('id') id: string) {
    return this.learning.submit(req.user, id);
  }

  @Post('learning/records/:id/publish')
  publish(@Req() req: { user: RequestUser }, @Param('id') id: string) {
    return this.learning.publish(req.user, id);
  }

  @Post('learning/records/:id/return')
  returnForChanges(@Req() req: { user: RequestUser }, @Param('id') id: string, @Body() dto: ReturnLearningDto) {
    return this.learning.returnForChanges(req.user, id, dto.note);
  }

  @Post('learning/records/:id/amend')
  amend(@Req() req: { user: RequestUser }, @Param('id') id: string, @Body() dto: AmendLearningDto) {
    return this.learning.amend(req.user, id, dto);
  }

  @Get('children/:childId/portfolio')
  portfolio(@Req() req: { user: RequestUser }, @Param('childId') childId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.learning.portfolio(req.user, childId, { from, to });
  }
}
