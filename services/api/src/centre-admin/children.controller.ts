import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { ChildrenService } from './children.service';
import { CreateChildDto } from './dto/create-child.dto';

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
}
