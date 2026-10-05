import { BadRequestException, Body, Controller, ParseArrayPipe, Post, Req, UseGuards } from '@nestjs/common';

const MAX_BATCH = 100;
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { SubmitOperationDto } from './dto/submit-operation.dto';
import { SyncService } from './sync.service';

@UseGuards(JwtAuthGuard)
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('operations')
  async submitBatch(
    @Req() req: { user: RequestUser },
    // The global ValidationPipe skips array elements; this validates each op and rejects non-arrays with 400.
    @Body(new ParseArrayPipe({ items: SubmitOperationDto, whitelist: true })) operations: SubmitOperationDto[],
  ) {
    if (operations.length > MAX_BATCH) throw new BadRequestException(`Send at most ${MAX_BATCH} operations per batch`);
    const results = [];
    for (const op of operations) {
      results.push(await this.sync.submit(req.user, op));
    }
    return { results };
  }
}
