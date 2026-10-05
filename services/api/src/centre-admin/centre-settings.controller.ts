import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { CentreSettingsService } from './centre-settings.service';

class UpdateCentreSettingsDto {
  @IsOptional()
  @IsInt()
  sleepCheckIntervalMinutes?: number;
}

@UseGuards(JwtAuthGuard)
@Controller('centre/settings')
export class CentreSettingsController {
  constructor(private readonly settings: CentreSettingsService) {}

  @Get()
  get(@Req() req: { user: RequestUser }) {
    return this.settings.get(req.user);
  }

  @Patch()
  update(@Req() req: { user: RequestUser }, @Body() dto: UpdateCentreSettingsDto) {
    return this.settings.update(req.user, dto);
  }
}
