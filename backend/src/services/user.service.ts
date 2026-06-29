import { getSupabaseClient } from "../lib/supabase";
import { UpdateProfileInput, updateProfileSchema } from "../validators/user.validators";
import { AppError, ErrorCode } from "../errors/errorCodes";
import { StrKey } from "@stellar/stellar-sdk";

/** 
 * Find a user by wallet address or create a new one if not exists.
 * Used during authentication flow.
 */
export async function findOrCreateUser(address: string) {
  if (!StrKey.isValidEd25519PublicKey(address)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid Stellar public key', 400);
  }

  const supabase = getSupabaseClient();
  const normalizedAddress = address.toLowerCase();

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
          return existing;
        }
      }

      if (createError) {
        throw new AppError(ErrorCode.INFRA_ERROR, 'Failed to create user record', 500);
      }
      return created;
    }

    if (error) {
      throw new AppError(ErrorCode.INFRA_ERROR, 'PostgreSQL query failed', 500);
    }

    return data;
  } catch (error: any) {
    if (error.name === 'AppError') throw error;
    throw new AppError(ErrorCode.INFRA_ERROR, 'User service dependency failure', 503);
  }
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
}
