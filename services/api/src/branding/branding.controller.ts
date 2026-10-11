import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { BrandingService } from './branding.service';
import { AddDomainDto, UpdateBrandDto } from './dto/branding.dto';

type Req_ = { user: RequestUser };
const PUBLIC_LIMIT = Throttle({ default: { limit: 60, ttl: 60000 } });

/**
 * White label (BRD v2.3 CUS-004). Three routes are public on purpose: the sign-in screens and the
 * certificate check run before anyone is signed in. Everything that changes anything requires an
 * organisation administrator (checked in the service), not just a signed-in user.
 */
@Controller('branding')
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  // ----- public -----

  /** The brand for the address the portal is served from, so a custom domain looks right before sign-in. */
  @PUBLIC_LIMIT
  @Get('public')
  publicBrand(@Query('host') host?: string) {
    return this.branding.getPublicBrandForHost(host ?? '');
  }

  /** The organisation's logo. Public so it can show on the sign-in screen; cross-origin so the portal on a custom domain can load it. */
  @PUBLIC_LIMIT
  @Get('logo/:orgId')
  async logo(@Param('orgId') orgId: string, @Res({ passthrough: true }) res: { set(headers: Record<string, string>): void }) {
    const logo = await this.branding.getLogo(orgId);
    if (!logo) throw new NotFoundException();
    res.set({
      'Content-Type': logo.contentType,
      // The address carries ?v=<version>, so a changed logo gets a new address and long caching is safe.
      'Cache-Control': 'public, max-age=86400',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'",
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(logo.data);
  }

  /** Caddy asks this before requesting a certificate for a custom domain. 404 means "do not issue". */
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @Get('domain-check')
  async domainCheck(@Query('domain') domain?: string, @Query('token') token?: string) {
    if (!(await this.branding.domainCheck(domain ?? '', token))) throw new NotFoundException();
    return { ok: true };
  }

  // ----- signed in -----

  @UseGuards(JwtAuthGuard)
  @Get()
  getBrand(@Req() req: Req_) {
    return this.branding.getBrand(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Put()
  updateBrand(@Req() req: Req_, @Body() dto: UpdateBrandDto) {
    return this.branding.updateBrand(req.user, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logo')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      // One small file; refuse anything bigger before buffering it (the service enforces 512 KB exactly).
      limits: { fileSize: 600 * 1024, files: 1, fields: 0, parts: 2, fieldNameSize: 100 },
    }),
  )
  uploadLogo(@Req() req: Req_, @UploadedFile() file: { buffer: Buffer; mimetype: string } | undefined) {
    if (!file) throw new BadRequestException('Attach the logo as the "file" field');
    return this.branding.setLogo(req.user, { buffer: file.buffer, mimetype: file.mimetype });
  }

  @UseGuards(JwtAuthGuard)
  @Delete('logo')
  removeLogo(@Req() req: Req_) {
    return this.branding.removeLogo(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('domains')
  listDomains(@Req() req: Req_) {
    return this.branding.listDomains(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Post('domains')
  addDomain(@Req() req: Req_, @Body() dto: AddDomainDto) {
    return this.branding.addDomain(req.user, dto.hostname);
  }

  @UseGuards(JwtAuthGuard)
  @Post('domains/:domainId/verify')
  @HttpCode(HttpStatus.OK)
  verifyDomain(@Req() req: Req_, @Param('domainId') domainId: string) {
    return this.branding.verifyDomain(req.user, domainId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('domains/:domainId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeDomain(@Req() req: Req_, @Param('domainId') domainId: string): Promise<void> {
    await this.branding.removeDomain(req.user, domainId);
  }
}
