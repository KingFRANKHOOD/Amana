import { Response, NextFunction } from "express";
import { AuthRequest } from "../services/auth.service";
import { findOrCreateUser, updateUser, getPublicProfile } from "../services/user.service";
import { ErrorCode } from '../errors/errorCodes';
import { AppError } from '../errors/appError';

/**
 * Get current user profile.
 * GET /users/me
 */
export async function getMe(req: AuthRequest, res: Response, next: NextFunction) {
  const callerWalletAddress = req.user?.walletAddress;
  if (!callerWalletAddress) {
    return next(new AppError(ErrorCode.AUTH_ERROR, "Unauthorized", 401));
  }

  try {
    const user = await findOrCreateUser(callerWalletAddress);
    res.json(user);
  } catch (err) {
    next(err);
  }
}

/**
 * Update current user profile.
 * PUT /users/me
 */
export async function updateMe(req: AuthRequest, res: Response, next: NextFunction) {
  const callerWalletAddress = req.user?.walletAddress;
  if (!callerWalletAddress) {
    return next(new AppError(ErrorCode.AUTH_ERROR, "Unauthorized", 401));
  }

  try {
    const user = await updateUser(callerWalletAddress, req.body);
    res.json(user);
  } catch (err) {
    next(err);
  }
}

/**
 * Get public profile by address.
 * GET /users/:address
 */
export async function getUserByAddress(req: AuthRequest, res: Response, next: NextFunction) {
  const raw = req.params.address;
  const address = Array.isArray(raw) ? raw[0] : raw;

  if (!address) {
    return next(new AppError(ErrorCode.VALIDATION_ERROR, "Wallet address is required", 400));
  }

  try {
    const user = await getPublicProfile(address);
    if (!user) {
      throw new AppError(ErrorCode.NOT_FOUND, "User not found", 404);
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
}
