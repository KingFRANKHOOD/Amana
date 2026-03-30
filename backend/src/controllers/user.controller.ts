import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { findOrCreateUser, updateUser, getPublicProfile } from "../services/user.service";
import { updateProfileSchema } from "../validators/user.validators";

export async function getMe(req: AuthRequest, res: Response) {
  const callerWalletAddress = req.user?.walletAddress;
  if (!callerWalletAddress) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const user = await findOrCreateUser(callerWalletAddress);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch profile" });
  }
}

export async function updateMe(req: AuthRequest, res: Response) {
  const callerWalletAddress = req.user?.walletAddress;
  if (!callerWalletAddress) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    const user = await updateUser(callerWalletAddress, parsed.data);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Failed to update profile" });
  }
}

export async function getUserByAddress(req: AuthRequest, res: Response) {
  const raw = req.params.address;
  const address = Array.isArray(raw) ? raw[0] : raw;
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
