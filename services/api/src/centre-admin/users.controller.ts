import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Req() req: { user: RequestUser }, @Query('role') role: 'PARENT' | 'EDUCATOR' | 'CENTRE_ADMIN') {
    return this.users.listByRole(req.user, role);
  }

  @Post()
  create(@Req() req: { user: RequestUser }, @Body() dto: CreateUserDto) {
    return this.users.create(req.user, dto);
  }
}
