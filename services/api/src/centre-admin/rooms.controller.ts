import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';

class SetLeadDto {
  @IsBoolean()
  isLead!: boolean;
}

@UseGuards(JwtAuthGuard)
@Controller('rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get()
  list(@Req() req: { user: RequestUser }) {
    return this.rooms.list(req.user);
  }

  @Get(':roomId/staff')
  staff(@Req() req: { user: RequestUser }, @Param('roomId') roomId: string) {
    return this.rooms.staff(req.user, roomId);
  }

  @Put(':roomId/staff/:userId/lead')
  setLead(@Req() req: { user: RequestUser }, @Param('roomId') roomId: string, @Param('userId') userId: string, @Body() dto: SetLeadDto) {
    return this.rooms.setLead(req.user, roomId, userId, dto.isLead);
  }

  @Post()
  create(@Req() req: { user: RequestUser }, @Body() dto: CreateRoomDto) {
    return this.rooms.create(req.user, dto);
  }
}
