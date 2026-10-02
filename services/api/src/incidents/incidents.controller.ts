import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { IncidentsService } from './incidents.service';
import { CreateIncidentDto } from './dto/create-incident.dto';

@UseGuards(JwtAuthGuard)
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Post()
  create(@Req() req: { user: RequestUser }, @Body() dto: CreateIncidentDto) {
    return this.incidents.create(req.user, dto);
  }

  @Post(':incidentId/acknowledge')
  acknowledge(@Req() req: { user: RequestUser }, @Param('incidentId') incidentId: string) {
    return this.incidents.acknowledge(req.user, incidentId);
  }

  @Post(':incidentId/review')
  review(
    @Req() req: { user: RequestUser },
    @Param('incidentId') incidentId: string,
    @Body() body: { reviewNotes?: string },
  ) {
    return this.incidents.review(req.user, incidentId, body.reviewNotes);
  }
}
