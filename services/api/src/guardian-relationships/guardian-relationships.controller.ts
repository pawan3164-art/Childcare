import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { GuardianRelationshipsService } from './guardian-relationships.service';
import { UpdatePickupAuthorizationDto } from './dto/update-pickup-authorization.dto';
import { CreateRelationshipDto } from './dto/create-relationship.dto';

@UseGuards(JwtAuthGuard)
@Controller('guardian-relationships')
export class GuardianRelationshipsController {
  constructor(private readonly relationships: GuardianRelationshipsService) {}

  @Get()
  listForChild(@Req() req: { user: RequestUser }, @Query('childId') childId: string) {
    return this.relationships.listForChild(req.user, childId);
  }

  @Post()
  create(@Req() req: { user: RequestUser }, @Body() dto: CreateRelationshipDto) {
    return this.relationships.create(req.user, dto);
  }

  @Patch(':relationshipId/pickup-authorization')
  updatePickupAuthorization(
    @Req() req: { user: RequestUser },
    @Param('relationshipId') relationshipId: string,
    @Body() dto: UpdatePickupAuthorizationDto,
  ) {
    return this.relationships.updatePickupAuthorization(req.user, relationshipId, dto);
  }
}
