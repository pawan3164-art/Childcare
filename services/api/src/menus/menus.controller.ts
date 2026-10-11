import { Body, Controller, Delete, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { ModuleGuard, RequiresModule } from '../features/module.guard';
import { MenusService } from './menus.service';

class MenuItemDto {
  @IsString() @MaxLength(500) description!: string;
  @IsOptional() @IsString() @MaxLength(500) allergenNotes?: string;
}

const WRITE_LIMIT = Throttle({ default: { limit: 60, ttl: 60000 } });

/** U4b: weekly menus. Administrators set them; educators and families read them. */
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequiresModule('menus')
@Controller()
export class MenusController {
  constructor(private readonly menus: MenusService) {}

  @Get('menus')
  list(@Req() req: { user: RequestUser }, @Query('from') from?: string, @Query('to') to?: string) {
    return this.menus.list(req.user, { from, to });
  }

  @WRITE_LIMIT
  @Put('menus/:date/:meal')
  set(@Req() req: { user: RequestUser }, @Param('date') date: string, @Param('meal') meal: string, @Body() dto: MenuItemDto) {
    return this.menus.set(req.user, date, meal, dto);
  }

  @WRITE_LIMIT
  @Delete('menus/:date/:meal')
  clear(@Req() req: { user: RequestUser }, @Param('date') date: string, @Param('meal') meal: string) {
    return this.menus.clear(req.user, date, meal);
  }
}
