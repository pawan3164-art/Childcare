import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { CareRecordsService } from './care-records.service';
import { CreateGroupCareRecordDto } from './dto/create-group-care-record.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class CareRecordsController {
  constructor(private readonly careRecords: CareRecordsService) {}

  @Post('care-records/group')
  createGroup(@Req() req: { user: RequestUser }, @Body() dto: CreateGroupCareRecordDto) {
    return this.careRecords.createGroupEvent(req.user, dto);
  }

  @Get('children/:childId/care-records')
  history(@Req() req: { user: RequestUser }, @Param('childId') childId: string) {
    return this.careRecords.history(req.user, childId);
  }
}
