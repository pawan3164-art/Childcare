import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../authorization/guards/staff-only.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { MAX_UPLOAD_BYTES, MediaService } from './media.service';

/** Multipart fields arrive as strings: accept a JSON array, a comma list, or repeated fields. */
function parseChildIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  if (raw.trim().startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      throw new BadRequestException('childIds must be a JSON array or comma-separated list');
    }
  }
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * The old POST /media (register an arbitrary storageKey) is gone now that
 * uploads are real: a client-supplied key could point at another tenant's
 * object. Assets are only created by upload, which chooses the key itself.
 */
@UseGuards(JwtAuthGuard)
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('upload')
  // Guards run before interceptors: parents are refused before multer parses anything.
  @UseGuards(StaffOnlyGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      // The upload takes one file plus childIds and roomId; refuse anything bigger before buffering it.
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4, parts: 6, fieldSize: 64 * 1024, fieldNameSize: 100 },
    }),
  )
  upload(
    @Req() req: { user: RequestUser },
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { childIds?: unknown; roomId?: unknown },
  ) {
    if (!file) throw new BadRequestException('Attach the photo as the "file" field');
    return this.media.upload(
      req.user,
      { buffer: file.buffer, mimetype: file.mimetype, size: file.size },
      // A repeated roomId field arrives as an array; the service rejects anything that isn't one room id.
      { childIds: parseChildIds(body.childIds), roomId: body.roomId === undefined || body.roomId === '' ? undefined : (body.roomId as string) },
    );
  }

  /** A 5-minute signed URL, issued only if every tagged child's permissions allow it. */
  @Get(':mediaAssetId/url')
  viewUrl(@Req() req: { user: RequestUser }, @Param('mediaAssetId') mediaAssetId: string) {
    return this.media.getViewUrl(req.user, mediaAssetId);
  }

  @Get(':mediaAssetId/can-view')
  async canView(@Req() req: { user: RequestUser }, @Param('mediaAssetId') mediaAssetId: string) {
    const allowed = await this.media.canView(req.user, mediaAssetId);
    if (!allowed) throw new ForbiddenException('Not authorized to view this media');
    return { allowed: true };
  }
}
