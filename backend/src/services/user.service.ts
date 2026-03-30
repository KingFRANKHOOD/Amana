import { getSupabaseClient } from "../lib/supabase";
import { UpdateProfileInput } from "../validators/user.validators";

export async function findOrCreateUser(address: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("address", address)
    .single();

  if (error && error.code === "PGRST116") {
    // Not found — auto-create
    const { data: created, error: createError } = await supabase
      .from("users")
      .insert({ address })
      .select()
      .single();

    if (createError) throw createError;
    return created;
  }

  if (error) throw error;
  return data;
}

export async function updateUser(address: string, input: UpdateProfileInput) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("users")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("address", address)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getPublicProfile(address: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("users")
    .select("address, display_name, avatar_url, created_at")
    .eq("address", address)
    .single();

  if (error && error.code === "PGRST116") return null;
  if (error) throw error;
  return data;
}
