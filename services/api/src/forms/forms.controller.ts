import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RequestUser } from '../authorization/request-user.interface';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { ModuleGuard, RequiresModule } from '../features/module.guard';
import { FormsService, SendRequestsInput, SubmitInput, TemplateInput } from './forms.service';

const WRITE_LIMIT = Throttle({ default: { limit: 30, ttl: 60000 } });

type Req_ = { user: RequestUser };

/**
 * U4c: digital forms and e-signature (ADR 0005). Administrators build templates and send requests; the addressed
 * guardian fills in and signs. Request bodies are validated in the service, which owns the field rules.
 */
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequiresModule('forms')
@Controller()
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  @Get('forms/templates')
  listTemplates(@Req() req: Req_) {
    return this.forms.listTemplates(req.user);
  }

  @WRITE_LIMIT
  @Post('forms/templates')
  createTemplate(@Req() req: Req_, @Body() dto: TemplateInput) {
    return this.forms.createTemplate(req.user, dto);
  }

  @Get('forms/templates/:id')
  getTemplate(@Req() req: Req_, @Param('id') id: string) {
    return this.forms.getTemplate(req.user, id);
  }

  @WRITE_LIMIT
  @Patch('forms/templates/:id')
  updateTemplate(@Req() req: Req_, @Param('id') id: string, @Body() dto: TemplateInput) {
    return this.forms.updateTemplate(req.user, id, dto);
  }

  @WRITE_LIMIT
  @Post('forms/templates/:id/publish')
  publishTemplate(@Req() req: Req_, @Param('id') id: string) {
    return this.forms.publishTemplate(req.user, id);
  }

  @WRITE_LIMIT
  @Post('forms/requests')
  sendRequests(@Req() req: Req_, @Body() dto: SendRequestsInput) {
    return this.forms.sendRequests(req.user, dto);
  }

  @Get('forms/requests')
  listRequests(@Req() req: Req_, @Query('status') status?: string, @Query('childId') childId?: string) {
    return this.forms.listRequests(req.user, { status, childId });
  }

  @WRITE_LIMIT
  @Post('forms/requests/:id/cancel')
  cancelRequest(@Req() req: Req_, @Param('id') id: string) {
    return this.forms.cancelRequest(req.user, id);
  }

  @Get('forms/my-requests')
  listMyRequests(@Req() req: Req_, @Query('status') status?: string) {
    return this.forms.listMyRequests(req.user, { status });
  }

  @Get('forms/my-requests/:id')
  getMyRequest(@Req() req: Req_, @Param('id') id: string) {
    return this.forms.getMyRequest(req.user, id);
  }

  /** The IP and user-agent are what the server observed; nothing about them is taken from the body. */
  @WRITE_LIMIT
  @Post('forms/my-requests/:id/submit')
  submitRequest(@Req() req: Req_ & { ip?: string; headers: Record<string, string | string[] | undefined> }, @Param('id') id: string, @Body() dto: SubmitInput) {
    const ua = req.headers['user-agent'];
    return this.forms.submitRequest(req.user, id, dto, { ip: req.ip, userAgent: Array.isArray(ua) ? ua[0] : ua });
  }

  @Get('forms/submissions/:id/verify')
  verifySubmission(@Req() req: Req_, @Param('id') id: string) {
    return this.forms.verifySubmission(req.user, id);
  }
}
