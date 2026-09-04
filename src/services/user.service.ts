import User from '../models/user.model';
import type { IUser } from '../models/user.model';
import { AppError } from '../utils/appError';

export const getById = async (userId: string): Promise<IUser> => {
  const user = await User.findById(userId);
  if (!user) throw AppError.notFound('User not found.', 'user_not_found');
  return user;
};
