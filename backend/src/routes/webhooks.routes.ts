import { Router, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { lookup } from 'dns/promises';
import net from 'net';
import { prisma } from '../lib/db';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validateRequest';
import { appLogger } from '../middleware/logger';
import { EncryptionService } from '../services/encryption.service';

const encryptionService = new EncryptionService();
const WEBHOOK_SECRET_CONTEXT = 'webhook-secret';

const router = Router();

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized.endsWith(".localhost");
}

function isBlockedIpAddress(address: string): boolean {
  const ipVersion = net.isIP(address);
  if (ipVersion === 0) return true;

  if (ipVersion === 4) {
    const octets = address.split(".").map((part) => Number(part));
    const [first = 0, second = 0] = octets;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      first >= 224
    );
  }

  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:169.254.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

async function validateWebhookUrl(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (parsed.username || parsed.password) return false;
  if (isBlockedHostname(parsed.hostname)) return false;

  const literalIp = net.isIP(parsed.hostname);
  if (literalIp !== 0) {
    return !isBlockedIpAddress(parsed.hostname);
  }

  try {
    const addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every((entry) => !isBlockedIpAddress(entry.address));
  } catch {
    return false;
  }
}

// Zod schemas for validation
const createWebhookSchema = z.object({
  url: z.string().url('Invalid URL format').refine(
    validateWebhookUrl,
    'Webhook URL must be publicly accessible and cannot resolve to internal services',
  ),
  events: z.array(z.string()).min(1, 'At least one event is required'),
  secret: z.string().optional(),
});

const webhookIdParamSchema = z.object({
  id: z.string().regex(/^\d+$/, 'Invalid webhook ID').transform(Number),
});

// Encrypts the secret reversibly (AES-256-GCM) so it can be recovered to sign
// outgoing webhook payloads. A one-way hash cannot be used here because the
// subscriber never re-sends the secret for us to compare against.
function encryptSecret(secret: string): string {
  return encryptionService.encrypt(secret, WEBHOOK_SECRET_CONTEXT);
}

// Helper function to generate a random secret
function generateSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Helper function to get user ID from wallet address
async function getUserIdFromWallet(walletAddress: string): Promise<number | null> {
  const user = await prisma.user.findUnique({
    where: { walletAddress: walletAddress.toLowerCase() },
    select: { id: true },
  });
  return user?.id ?? null;
}

// POST /webhooks - Register a new webhook
router.post(
  '/',
  authMiddleware,
  validateRequest({ body: createWebhookSchema }),
  async (req: AuthRequest, res: Response) => {
    try {
      const { url, events, secret } = req.body;
      const walletAddress = req.user?.walletAddress;

      if (!walletAddress) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const userId = await getUserIdFromWallet(walletAddress);
      if (!userId) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Generate secret if not provided
      const webhookSecret = secret || generateSecret();
      const secretHash = encryptSecret(webhookSecret);

      // Create webhook subscription
      const webhook = await prisma.webhookSubscription.create({
        data: {
          url,
          events,
          secretHash,
          userId,
        },
      });

      appLogger.info(
        {
          userId,
          webhookId: webhook.id,
          events,
          providedSecret: Boolean(secret),
        },
        "Webhook secret generated",
      );

      res.setHeader("X-Webhook-Secret", webhookSecret);
      res.setHeader("X-Webhook-Secret-Warning", "shown-only-once");

      res.status(201).json({
        id: webhook.id,
        url: webhook.url,
        events: webhook.events,
        secretShown: true,
        secretDelivery: "response_header",
        warning: "Webhook secret is shown only once in the X-Webhook-Secret response header.",
        isActive: webhook.isActive,
        createdAt: webhook.createdAt,
      });
    } catch (error) {
      console.error('Error creating webhook:', error);
      res.status(500).json({ error: 'Failed to create webhook' });
    }
  }
);

// GET /webhooks - List all webhooks for the authenticated user
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const walletAddress = req.user?.walletAddress;

    if (!walletAddress) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = await getUserIdFromWallet(walletAddress);
    if (!userId) {
      return res.status(404).json({ error: 'User not found' });
    }

    const webhooks = await prisma.webhookSubscription.findMany({
      where: { userId },
      select: {
        id: true,
        url: true,
        events: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({ webhooks });
  } catch (error) {
    console.error('Error listing webhooks:', error);
    res.status(500).json({ error: 'Failed to list webhooks' });
  }
});

// DELETE /webhooks/:id - Delete a webhook by ID
router.delete(
  '/:id',
  authMiddleware,
  validateRequest({ params: webhookIdParamSchema }),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      const walletAddress = req.user?.walletAddress;

      if (!walletAddress) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const userId = await getUserIdFromWallet(walletAddress);
      if (!userId) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Verify the webhook belongs to the user
      const webhook = await prisma.webhookSubscription.findUnique({
        where: { id },
      });

      if (!webhook) {
        return res.status(404).json({ error: 'Webhook not found' });
      }

      if (webhook.userId !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      // Delete the webhook
      await prisma.webhookSubscription.delete({
        where: { id },
      });

      res.status(200).json({ message: 'Webhook deleted successfully' });
    } catch (error) {
      console.error('Error deleting webhook:', error);
      res.status(500).json({ error: 'Failed to delete webhook' });
    }
  }
);

export { router as webhooksRoutes };
