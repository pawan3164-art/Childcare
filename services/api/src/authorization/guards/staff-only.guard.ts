import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { STAFF_ROLES } from '../authorization.service';
import { RequestUser } from '../request-user.interface';

/**
 * Route-level staff check for endpoints where the role must be enforced
 * before the request body is processed (e.g. multipart uploads, which
 * interceptors parse before the handler runs). Services still check roles
 * themselves; this only moves the refusal earlier. Use after JwtAuthGuard.
 */
@Injectable()
export class StaffOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<{ user?: RequestUser }>().user;
    if (!user || !STAFF_ROLES.includes(user.role)) throw new ForbiddenException('This action is restricted to centre staff');
    return true;
  }
}
