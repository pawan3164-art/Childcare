import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { MedicationService } from './medication.service';
import { CreateAuthorizationDto } from './dto/create-authorization.dto';
import { RecordAdministrationDto } from './dto/record-administration.dto';

@UseGuards(JwtAuthGuard)
@Controller('medication')
export class MedicationController {
  constructor(private readonly medication: MedicationService) {}

  @Post('authorizations')
  authorize(@Req() req: { user: RequestUser }, @Body() dto: CreateAuthorizationDto) {
    return this.medication.authorize(req.user, dto);
  }

  @Post('administrations')
  recordAdministration(@Req() req: { user: RequestUser }, @Body() dto: RecordAdministrationDto) {
    return this.medication.recordAdministration(req.user, dto);
  }

  @Post('administrations/:administrationId/review')
  review(
    @Req() req: { user: RequestUser },
    @Param('administrationId') administrationId: string,
    @Body() body: { decision: 'CONFIRMED' | 'REJECTED'; notes?: string },
  ) {
    return this.medication.review(req.user, administrationId, body.decision, body.notes);
  }
}
