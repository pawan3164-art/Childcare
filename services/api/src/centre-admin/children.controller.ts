import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { ChildrenService } from './children.service';
import { CreateChildDto } from './dto/create-child.dto';
import { GroupPhotoConsentDto } from './dto/group-photo-consent.dto';

@UseGuards(JwtAuthGuard)
@Controller('children')
export class ChildrenController {
  constructor(private readonly children: ChildrenService) {}

  @Get()
  list(@Req() req: { user: RequestUser }, @Query('roomId') roomId?: string) {
    return this.children.list(req.user, roomId);
  }

  @Post()
  create(@Req() req: { user: RequestUser }, @Body() dto: CreateChildDto) {
    return this.children.create(req.user, dto);
  }

  @Patch(':childId/group-photo-consent')
  setGroupPhotoConsent(@Req() req: { user: RequestUser }, @Param('childId') childId: string, @Body() dto: GroupPhotoConsentDto) {
    return this.children.setGroupPhotoConsent(req.user, childId, dto.consent);
  }
}
