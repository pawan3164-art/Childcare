import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthorizationService, ChildPermission } from '../authorization.service';
import { CHILD_ACCESS_KEY, CHILD_PARAM_KEY } from '../decorators/require-child-access.decorator';
import { RequestUser } from '../request-user.interface';

@Injectable()
export class ChildAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.get<ChildPermission | undefined>(
      CHILD_ACCESS_KEY,
      context.getHandler(),
    );
    if (!permission) return true; // route doesn't require child-level access

    const paramName =
      this.reflector.get<string>(CHILD_PARAM_KEY, context.getHandler()) ?? 'childId';

    const req = context.switchToHttp().getRequest<Request & { user: RequestUser }>();
    const fromParams = req.params[paramName];
    const fromBody = (req.body as Record<string, unknown> | undefined)?.[paramName];
    const childId = (Array.isArray(fromParams) ? fromParams[0] : fromParams) ?? (fromBody as string | undefined);

    if (!childId) return false;

    await this.authorization.assertCanAccessChild(req.user, childId, permission);
    return true;
  }
}
