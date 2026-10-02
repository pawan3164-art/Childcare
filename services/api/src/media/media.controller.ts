import { Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { MediaService } from './media.service';
import { RegisterMediaDto } from './dto/register-media.dto';

@UseGuards(JwtAuthGuard)
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  register(@Req() req: { user: RequestUser }, @Body() dto: RegisterMediaDto) {
    return this.media.register(req.user, dto);
  }

  /**
   * Stage 1: returns whether the viewer may see this asset, not the asset
   * bytes themselves (no real file storage/signed URLs yet — see
   * RegisterMediaDto). A real "view" endpoint streams/redirects to a signed
   * URL only after this same check.
   */
  @Get(':mediaAssetId/can-view')
  async canView(@Req() req: { user: RequestUser }, @Param('mediaAssetId') mediaAssetId: string) {
    const allowed = await this.media.canView(req.user, mediaAssetId);
    if (!allowed) throw new ForbiddenException('Not authorized to view this media');
    return { allowed: true };
  }
}
