import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { ChecklistsService } from './checklists.service';
import { CompleteChecklistDto, CreateChecklistTemplateDto } from './dto/checklist.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class ChecklistsController {
  constructor(private readonly checklists: ChecklistsService) {}

  @Get('checklists/templates')
  listTemplates(@Req() req: { user: RequestUser }) {
    return this.checklists.listTemplates(req.user);
  }

  @Post('checklists/templates')
  createTemplate(@Req() req: { user: RequestUser }, @Body() dto: CreateChecklistTemplateDto) {
    return this.checklists.createTemplate(req.user, dto);
  }

  @Post('checklists/templates/:templateId/archive')
  archive(@Req() req: { user: RequestUser }, @Param('templateId') templateId: string) {
    return this.checklists.archiveTemplate(req.user, templateId);
  }

  @Get('rooms/:roomId/checklists')
  roomChecklists(@Req() req: { user: RequestUser }, @Param('roomId') roomId: string) {
    return this.checklists.roomChecklists(req.user, roomId);
  }

  @Post('checklists/completions')
  complete(@Req() req: { user: RequestUser }, @Body() dto: CompleteChecklistDto) {
    return this.checklists.complete(req.user, dto);
  }

  @Get('rooms/:roomId/checklist-completions')
  completions(@Req() req: { user: RequestUser }, @Param('roomId') roomId: string, @Query('date') date?: string) {
    return this.checklists.completions(req.user, { roomId, date });
  }
}
