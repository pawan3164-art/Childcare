import { Body, Controller, Get, Param, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { HqService } from './hq.service';

const WRITE_LIMIT = Throttle({ default: { limit: 30, ttl: 60000 } });

type Req_ = { user: RequestUser };

/**
 * Multi-site HQ (BRD v2.3 §36.4). Not a switchable module: who may call it is decided in the service from the caller's
 * role (organisation administrators, platform administrators, and area managers for their own centres).
 */
@UseGuards(JwtAuthGuard)
@Controller()
export class HqController {
  constructor(private readonly hq: HqService) {}

  @Get('hq/centres')
  listCentres(@Req() req: Req_) {
    return this.hq.listCentres(req.user);
  }

  @Get('hq/occupancy')
  occupancy(@Req() req: Req_, @Query('date') date?: string, @Query('days') days?: string) {
    return this.hq.occupancy(req.user, { date, days: days === undefined ? undefined : Number(days) });
  }

  @Get('hq/financials')
  financials(@Req() req: Req_, @Query('from') from?: string, @Query('to') to?: string) {
    return this.hq.financials(req.user, { from, to });
  }

  @Get('hq/financials.csv')
  async financialsCsv(@Req() req: Req_, @Res({ passthrough: true }) res: { setHeader(name: string, value: string): void }, @Query('from') from?: string, @Query('to') to?: string) {
    const csv = await this.hq.financialsCsv(req.user, { from, to });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="financial-overview.csv"');
    return csv;
  }

  @WRITE_LIMIT
  @Put('hq/area-managers/:userId/centres')
  setAreaManagerCentres(@Req() req: Req_, @Param('userId') userId: string, @Body() body: { centreIds?: unknown }) {
    return this.hq.setAreaManagerCentres(req.user, userId, body?.centreIds);
  }

  @Get('hq/area-managers/:userId/centres')
  getAreaManagerCentres(@Req() req: Req_, @Param('userId') userId: string) {
    return this.hq.getAreaManagerCentres(req.user, userId);
  }

  @WRITE_LIMIT
  @Put('hq/centres/:centreId/capacity')
  setCentreCapacity(@Req() req: Req_, @Param('centreId') centreId: string, @Body() body: { capacity?: unknown }) {
    return this.hq.setCentreCapacity(req.user, centreId, body?.capacity ?? null);
  }
}
