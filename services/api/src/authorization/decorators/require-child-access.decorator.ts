import { SetMetadata } from '@nestjs/common';
import { ChildPermission } from '../authorization.service';

export const CHILD_ACCESS_KEY = 'childAccessPermission';
export const CHILD_PARAM_KEY = 'childAccessParam';

/**
 * Marks a route as requiring relationship-based access to a specific child.
 * `childIdParam` names the route/body param holding the child id (default "childId").
 * Enforced by ChildAccessGuard.
 */
export const RequireChildAccess = (permission: ChildPermission, childIdParam = 'childId') =>
  (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    SetMetadata(CHILD_ACCESS_KEY, permission)(target, key as string, descriptor as PropertyDescriptor);
    SetMetadata(CHILD_PARAM_KEY, childIdParam)(target, key as string, descriptor as PropertyDescriptor);
  };
