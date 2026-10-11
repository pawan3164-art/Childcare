import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestUser } from '../authorization/request-user.interface';
import { FeaturesService } from './features.service';
import { moduleDef } from './features.registry';

export const REQUIRES_MODULE_KEY = 'requires:module';

/** Marks a controller (or one route) as part of an optional module. A method-level mark overrides the class's. */
export const RequiresModule = (key: string) => SetMetadata(REQUIRES_MODULE_KEY, key);

/**
 * Refuses requests for a module the centre does not have. Runs after JwtAuthGuard, which sets `request.user`;
 * without a user it steps aside and lets authentication answer.
 */
@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly features: FeaturesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string | undefined>(REQUIRES_MODULE_KEY, [context.getHandler(), context.getClass()]);
    if (!key) return true;

    const user = context.switchToHttp().getRequest<{ user?: RequestUser }>().user;
    if (!user) return true;
    if (!user.orgId) throw new ForbiddenException();

    if (await this.features.isEnabled(user.orgId, user.centreId, key)) return true;
    throw new ForbiddenException(`${moduleDef(key)?.label ?? 'This feature'} is switched off for your centre`);
  }
}
