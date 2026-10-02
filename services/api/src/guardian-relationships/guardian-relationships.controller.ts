import { Body, Controller, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { GuardianRelationshipsService } from './guardian-relationships.service';
import { UpdatePickupAuthorizationDto } from './dto/update-pickup-authorization.dto';

@UseGuards(JwtAuthGuard)
@Controller('guardian-relationships')
export class GuardianRelationshipsController {
  constructor(private readonly relationships: GuardianRelationshipsService) {}

  @Patch(':relationshipId/pickup-authorization')
  updatePickupAuthorization(
    @Req() req: { user: RequestUser },
    @Param('relationshipId') relationshipId: string,
    @Body() dto: UpdatePickupAuthorizationDto,
  ) {
    return this.relationships.updatePickupAuthorization(req.user, relationshipId, dto);
  }
}
