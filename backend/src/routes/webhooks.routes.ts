import { Router, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../lib/db';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validateRequest';

const router = Router();

// Zod schemas for validation
const createWebhookSchema = z.object({
  url: z.string().url('Invalid URL format'),
  events: z.array(z.string()).min(1, 'At least one event is required'),
  secret: z.string().optional(),
});

const webhookIdParamSchema = z.object({
  id: z.string().regex(/^\d+$/, 'Invalid webhook ID').transform(Number),
});

// Helper function to hash secret using SHA-256
function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
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
      const secretHash = hashSecret(webhookSecret);

      // Create webhook subscription
      const webhook = await prisma.webhookSubscription.create({
        data: {
          url,
          events,
          secretHash,
          userId,
        },
      });

      // Return the webhook with the unhashed secret (only on creation)
      res.status(201).json({
        id: webhook.id,
        url: webhook.url,
        events: webhook.events,
        secret: webhookSecret, // Return unhashed secret for user to save
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
      const { id } = req.params;
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
