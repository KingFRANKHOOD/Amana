import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { findOrCreateUser, updateUser, getPublicProfile } from "../services/user.service";
import { updateProfileSchema } from "../validators/user.validators";

export async function getMe(req: AuthRequest, res: Response) {
  try {
    const user = await findOrCreateUser(req.userAddress!);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch profile" });
  }
}

export async function updateMe(req: AuthRequest, res: Response) {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    const user = await updateUser(req.userAddress!, parsed.data);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Failed to update profile" });
  }
}

export async function getUserByAddress(req: AuthRequest, res: Response) {
  const { address } = req.params;
  try {
    const user = await getPublicProfile(address);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch profile" });
  }
}
