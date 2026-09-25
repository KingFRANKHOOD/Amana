import { PrismaClient } from "@prisma/client";
import { Response, Router } from "express";
import { z } from "zod";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware } from "../middleware/auth.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { AuthRequest } from "../services/auth.service";

/**
 * The set of event-type keys that users may configure notification channels
 * for. Mirrors the EventType enum in src/types/events.ts — any new event type
 * added there should be reflected here as well.
 */
export const KNOWN_NOTIFICATION_EVENT_TYPES = [
  "TradeCreated",
  "TradeFunded",
  "TradeCancelled",
  "TradeCancelledByBuyer",
  "TradeExpired",
  "DeliveryConfirmed",
  "FundsReleased",
  "DisputeInitiated",
  "DisputeResolved",
  "EvidenceSubmitted",
  "VideoProofSubmitted",
  "ManifestSubmitted",
  "DeadlineExtended",
  "MediatorAdded",
  "MediatorRemoved",
  "FeeRateUpdated",
  "FeesWithdrawn",
  "PathPaymentInitiated",
  "PathPaymentExecuted",
  "ContractUpgraded",
] as const;

type NotificationEventType = (typeof KNOWN_NOTIFICATION_EVENT_TYPES)[number];

const MAX_PREFERENCE_KEYS = KNOWN_NOTIFICATION_EVENT_TYPES.length;

const notificationChannelSchema = z.enum(["email", "push", "in-app"]);

/**
 * Preference body schema.
 * - Keys must be one of the known event types (no arbitrary strings).
 * - At most MAX_PREFERENCE_KEYS keys per request (prevents storage abuse).
 * - Each value is an array of up to 3 channels.
 */
const preferencesSchema = z
  .record(
    z.enum(KNOWN_NOTIFICATION_EVENT_TYPES),
    z.array(notificationChannelSchema).max(3),
  )
  .refine((obj) => Object.keys(obj).length <= MAX_PREFERENCE_KEYS, {
    message: `Preferences may contain at most ${MAX_PREFERENCE_KEYS} keys`,
  });

type Preferences = Partial<
  Record<NotificationEventType, Array<"email" | "push" | "in-app">>
>;

type PreferencePrisma = PrismaClient & {
  notificationPreference?: {
    findUnique: (args: any) => Promise<{ preferences: unknown } | null>;
    upsert: (args: any) => Promise<{ preferences: unknown }>;
  };
};

function caller(req: AuthRequest, res: Response): string | null {
  const walletAddress = req.user?.walletAddress?.trim();
  if (!walletAddress) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return walletAddress;
}

/**
 * Parse and validate stored preferences. Unlike the request-body path this
 * function is lenient about unknown keys that may have been stored by an older
 * version of the schema — it simply drops them rather than erroring out.
 * Callers that supply untrusted request data must use `preferencesSchema`
 * via `validateRequest` middleware instead.
 */
function normalizePreferences(value: unknown): Preferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Preferences = {};
  const channelSchema = z.array(z.enum(["email", "push", "in-app"])).max(3);
  for (const key of KNOWN_NOTIFICATION_EVENT_TYPES) {
    const raw = (value as Record<string, unknown>)[key];
    if (raw === undefined) continue;
    const parsed = channelSchema.safeParse(raw);
    if (parsed.success) {
      result[key] = parsed.data;
    }
  }
  return result;
}

export function createNotificationPreferencesRouter(
  prisma: PreferencePrisma = defaultPrisma as PreferencePrisma,
) {
  const router = Router();

  router.get(
    "/notifications/preferences",
    authMiddleware,
    async (req: AuthRequest, res, next) => {
      try {
        const walletAddress = caller(req, res);
        if (!walletAddress) return;

        const record = await prisma.notificationPreference?.findUnique({
          where: { userAddress: walletAddress },
        });

        res
          .status(200)
          .json({ preferences: normalizePreferences(record?.preferences) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    "/notifications/preferences",
    authMiddleware,
    validateRequest({ body: preferencesSchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const walletAddress = caller(req, res);
        if (!walletAddress) return;

        const incoming = req.body as Preferences;
        const existing = await prisma.notificationPreference?.findUnique({
          where: { userAddress: walletAddress },
        });
        const merged: Preferences = {
          ...normalizePreferences(existing?.preferences),
          ...incoming,
        };

        const saved = await prisma.notificationPreference?.upsert({
          where: { userAddress: walletAddress },
          create: { userAddress: walletAddress, preferences: merged },
          update: { preferences: merged },
        });

        res.status(200).json({
          preferences: normalizePreferences(saved?.preferences ?? merged),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

export const notificationPreferencesRoutes =
  createNotificationPreferencesRouter();
