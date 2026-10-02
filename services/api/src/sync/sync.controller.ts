import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
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
    @Body() operations: SubmitOperationDto[],
  ) {
    const results = [];
    for (const op of operations) {
      results.push(await this.sync.submit(req.user, op));
    }
    return { results };
  }
}
