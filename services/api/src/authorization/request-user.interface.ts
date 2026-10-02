import { UserRole } from '@prisma/client';

/** Shape of req.user after JwtStrategy validates the access token. */
export interface RequestUser {
  userId: string;
  orgId: string | null;
  centreId: string | null;
  role: UserRole;
}

export interface JwtPayload {
  sub: string;
  orgId: string | null;
  centreId: string | null;
  role: UserRole;
}
