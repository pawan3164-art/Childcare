import { Global, Module } from '@nestjs/common';
import { AuthorizationService } from './authorization.service';
import { ChildAccessGuard } from './guards/child-access.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

/**
 * Deliberately NOT registered as global APP_GUARD providers: global guards run
 * before any controller-level @UseGuards, which would run ChildAccessGuard
 * before JwtAuthGuard has populated req.user. Instead, controllers that need
 * child-level access control apply both explicitly, in order:
 *   @UseGuards(JwtAuthGuard, ChildAccessGuard)
 * ChildAccessGuard is a no-op (returns true) on routes without
 * @RequireChildAccess metadata, so it's safe to add to any controller.
 */
@Global()
@Module({
  providers: [AuthorizationService, ChildAccessGuard, JwtAuthGuard],
  exports: [AuthorizationService, ChildAccessGuard, JwtAuthGuard],
})
export class AuthorizationModule {}
