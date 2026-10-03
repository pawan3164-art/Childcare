import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';

@UseGuards(JwtAuthGuard)
@Controller('rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get()
  list(@Req() req: { user: RequestUser }) {
    return this.rooms.list(req.user);
  }

  @Post()
  create(@Req() req: { user: RequestUser }, @Body() dto: CreateRoomDto) {
    return this.rooms.create(req.user, dto);
  }
}
