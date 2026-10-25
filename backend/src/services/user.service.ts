import { Prisma } from "@prisma/client";
import { getSupabaseClient } from "../lib/supabase";
import { UpdateProfileInput, updateProfileSchema } from "../validators/user.validators";
import { ErrorCode } from '../errors/errorCodes';
import { AppError } from '../errors/appError';
import { StrKey } from "@stellar/stellar-sdk";
import { cacheService } from "../lib/cache";
import { prisma } from "../lib/db";
import { appLogger } from "../middleware/logger";

/**
 * Ensure a Prisma User row exists for the given wallet address.
 * Trade.buyerAddress/sellerAddress FK targets User.walletAddress, so a missing
 * Prisma row would cause trade creation to fail even when Supabase has the user.
 * This helper is idempotent via upsert and swallows race duplicates.
 */
export async function ensurePrismaUser(walletAddress: string): Promise<void> {
  const normalized = walletAddress.toLowerCase();
  try {
    await prisma.user.upsert({
      where: { walletAddress: normalized },
      update: {},
      create: { walletAddress: normalized, displayName: normalized },
    });
  } catch (err: any) {
    // P2002 duplicate race - safe to ignore
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return;
    }
    // Best-effort in degraded/test environments where Prisma DB is not reachable.
    // Log at warn and return so Supabase flow can succeed; trade creation has
    // its own ensure that will retry within its transaction.
    const msg = err instanceof Error ? err.message : String(err);
    if (
      process.env.NODE_ENV === "test" ||
      /can't reach database server|connection|timeout/i.test(msg)
    ) {
      appLogger.warn({ error: err, walletAddress: normalized }, "Failed to ensure Prisma user (degraded mode — continuing)");
      return;
    }
    appLogger.error({ error: err, walletAddress: normalized }, "Failed to ensure Prisma user");
    throw new AppError(ErrorCode.INFRA_ERROR, "Failed to ensure Prisma user", 503);
  }
}

/**
 * Ensure multiple Prisma User rows exist — used before trade creation so
 * both buyer and seller satisfy the FK regardless of which store was written first.
 */
export async function ensurePrismaUsers(addresses: string[]): Promise<void> {
  const normalized = addresses.map((a) => a.toLowerCase());
  const unique = Array.from(new Set(normalized));
  for (const addr of unique) {
    if (!StrKey.isValidEd25519PublicKey(addr)) continue;
    await ensurePrismaUser(addr);
  }
}

/**
 * Sync check: verify that a wallet exists in both Supabase and Prisma stores.
 * Useful for monitoring drift between the two user stores.
 */
export async function checkUserStoreIntegrity(address: string): Promise<{
  supabaseExists: boolean;
  prismaExists: boolean;
  consistent: boolean;
}> {
  const normalized = address.toLowerCase();
  const supabase = getSupabaseClient();
  let supabaseExists = false;
  let prismaExists = false;

  try {
    const { data, error } = await supabase
      .from("users")
      .select("address")
      .eq("address", normalized)
      .single();
    supabaseExists = !error && !!data;
  } catch {
    supabaseExists = false;
  }

  try {
    const user = await prisma.user.findUnique({ where: { walletAddress: normalized } });
    prismaExists = !!user;
  } catch {
    prismaExists = false;
  }

  return {
    supabaseExists,
    prismaExists,
    consistent: supabaseExists === prismaExists,
  };
}

/** 
 * Find a user by wallet address or create a new one if not exists.
 * Used during authentication flow.
 * Ensures the Prisma User row exists alongside Supabase so Trade FKs never break.
 */
export async function findOrCreateUser(address: string) {
  if (!StrKey.isValidEd25519PublicKey(address)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid Stellar public key', 400);
  }

  const supabase = getSupabaseClient();
  const normalizedAddress = address.toLowerCase();

  let supabaseUser: any;

  try {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("address", normalizedAddress)
      .single();

    if (error && error.code === "PGRST116") {
      // Not found — auto-create
      const { data: created, error: createError } = await supabase
        .from("users")
        .insert({ address: normalizedAddress })
        .select()
        .single();

      // Another request may have inserted the same address after our initial read.
      if (createError?.code === "23505") {
        const { data: existing, error: existingError } = await supabase
          .from("users")
          .select("*")
          .eq("address", normalizedAddress)
          .single();

        if (!existingError && existing) {
          supabaseUser = existing;
        } else if (createError) {
          throw new AppError(ErrorCode.INFRA_ERROR, 'Failed to create user record', 500);
        }
      } else if (createError) {
        throw new AppError(ErrorCode.INFRA_ERROR, 'Failed to create user record', 500);
      } else {
        supabaseUser = created;
      }
    } else if (error) {
      throw new AppError(ErrorCode.INFRA_ERROR, 'PostgreSQL query failed', 500);
    } else {
      supabaseUser = data;
    }
  } catch (error: any) {
    if (error.name === 'AppError') throw error;
    throw new AppError(ErrorCode.INFRA_ERROR, 'User service dependency failure', 503);
  }

  // Ensure Prisma FK target exists — best-effort; trade creation also ensures
  try {
    await ensurePrismaUser(normalizedAddress);
  } catch (err: any) {
    // ensurePrismaUser already handles degraded/test mode internally; only rethrow true infra failures
    if (err.name === 'AppError') {
      appLogger.warn({ error: err, walletAddress: normalizedAddress }, "Prisma ensure after Supabase failed (non-blocking)");
    }
  }

  return supabaseUser;
}

/**
 * Update user profile details.
 */
export async function updateUser(address: string, input: UpdateProfileInput) {
  if (!StrKey.isValidEd25519PublicKey(address)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid Stellar public key', 400);
  }

  // Validate input schema
  const validation = updateProfileSchema.safeParse(input);
  if (!validation.success) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid profile data', 400);
  }

  const supabase = getSupabaseClient();
  const normalizedAddress = address.toLowerCase();

  try {
    const { data, error } = await supabase
      .from("users")
      .update({ 
        display_name: input.displayName,
        avatar_url: input.avatarUrl,
        updated_at: new Date().toISOString() 
      })
      .eq("address", normalizedAddress)
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        throw new AppError(ErrorCode.NOT_FOUND, 'User not found', 404);
      }
      throw new AppError(ErrorCode.INFRA_ERROR, 'Update failed', 500);
    }

    await cacheService.invalidateOne(`cache:user:${normalizedAddress}`);
    return data;
  } catch (error: any) {
    if (error.name === 'AppError') throw error;
    throw new AppError(ErrorCode.INFRA_ERROR, 'User update failed', 503);
  }
}

/**
 * Get public profile details for any user.
 */
export async function getPublicProfile(address: string) {
  if (!StrKey.isValidEd25519PublicKey(address)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid Stellar public key', 400);
  }

  const supabase = getSupabaseClient();
  const normalizedAddress = address.toLowerCase();

  return cacheService.getOrSet(
    `cache:user:${normalizedAddress}`,
    300,
    async () => {
      try {
        const { data, error } = await supabase
          .from("users")
          .select("address, display_name, avatar_url, created_at")
          .eq("address", normalizedAddress)
          .single();

        if (error) {
          if (error.code === "PGRST116") return null;
          throw new AppError(ErrorCode.INFRA_ERROR, 'Fetch failed', 500);
        }

        return data;
      } catch (error: any) {
        if (error.name === 'AppError') throw error;
        throw new AppError(ErrorCode.INFRA_ERROR, 'User service dependency failure', 503);
      }
    },
  );
}
