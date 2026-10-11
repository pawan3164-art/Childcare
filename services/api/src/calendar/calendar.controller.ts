import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { ModuleGuard, RequiresModule } from '../features/module.guard';
import { CalendarService } from './calendar.service';

class EventDto {
  @IsString() @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsDateString() startsAt!: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsBoolean() allDay?: boolean;
  @IsOptional() @IsString() roomId?: string;
}

class UpdateEventDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string | null;
  @IsOptional() @IsBoolean() allDay?: boolean;
  @IsOptional() @IsString() roomId?: string | null;
}

class CancelDto {
  @IsString() @MaxLength(500) reason!: string;
}

const WRITE_LIMIT = Throttle({ default: { limit: 30, ttl: 60000 } });

/** U4b: the centre calendar. Administrators change it; educators and families read it. */
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequiresModule('calendar')
@Controller()
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('calendar/events')
  listEvents(@Req() req: { user: RequestUser }, @Query('from') from?: string, @Query('to') to?: string) {
    return this.calendar.listEvents(req.user, { from, to });
  }

  @WRITE_LIMIT
  @Post('calendar/events')
  createEvent(@Req() req: { user: RequestUser }, @Body() dto: EventDto) {
    return this.calendar.createEvent(req.user, dto);
  }

  @WRITE_LIMIT
  @Patch('calendar/events/:id')
  updateEvent(@Req() req: { user: RequestUser }, @Param('id') id: string, @Body() dto: UpdateEventDto) {
    return this.calendar.updateEvent(req.user, id, dto);
  }

  @WRITE_LIMIT
  @Post('calendar/events/:id/cancel')
  cancelEvent(@Req() req: { user: RequestUser }, @Param('id') id: string, @Body() dto: CancelDto) {
    return this.calendar.cancelEvent(req.user, id, dto.reason);
  }
}
