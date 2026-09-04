import type { UserRole } from '../models/user.model';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireAuth. Absent on unauthenticated routes. */
      auth?: {
        userId: string;
        role: UserRole;
      };
    }
  }
}

export {};
