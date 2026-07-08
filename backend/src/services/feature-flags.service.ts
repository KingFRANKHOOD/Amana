import { redis } from "../lib/redis";

const FLAG_KEY_PREFIX = "feature:";

export interface FeatureFlagRecord {
  enabled: boolean;
  /** 0-100. When set, gates the flag to a deterministic subset of users, keyed by user id. */
  rolloutPercentage?: number;
  updatedAt: string;
}

export interface FeatureFlagUpdate {
  enabled: boolean;
  rolloutPercentage?: number;
}

function flagKey(name: string): string {
  return `${FLAG_KEY_PREFIX}${name}`;
}

/**
 * Deterministic 0-99 bucket for a string, using FNV-1a. Same input always
 * yields the same bucket, and buckets are spread evenly over many inputs -
 * this is what makes percentage rollouts sticky per-user instead of a coin
 * flip on every request.
 */
function hashToBucket(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash) % 100;
}

export class FeatureFlagService {
  async getFlag(name: string): Promise<FeatureFlagRecord | null> {
    const raw = await redis.get(flagKey(name));
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as FeatureFlagRecord;
    } catch {
      return null;
    }
  }

  async listFlags(): Promise<Record<string, FeatureFlagRecord>> {
    const keys = (await redis.keys(`${FLAG_KEY_PREFIX}*`)) as string[];
    if (keys.length === 0) {
      return {};
    }

    const values = await Promise.all(keys.map((key: string) => redis.get(key)));
    const result: Record<string, FeatureFlagRecord> = {};

    keys.forEach((key: string, index: number) => {
      const raw = values[index];
      if (!raw) {
        return;
      }
      try {
        result[key.slice(FLAG_KEY_PREFIX.length)] = JSON.parse(raw) as FeatureFlagRecord;
      } catch {
        // Skip a corrupt entry rather than failing the whole listing.
      }
    });

    return result;
  }

  async setFlag(name: string, update: FeatureFlagUpdate): Promise<FeatureFlagRecord> {
    if (
      update.rolloutPercentage !== undefined &&
      (update.rolloutPercentage < 0 || update.rolloutPercentage > 100)
    ) {
      throw new RangeError("rolloutPercentage must be between 0 and 100");
    }

    const record: FeatureFlagRecord = {
      enabled: update.enabled,
      rolloutPercentage: update.rolloutPercentage,
      updatedAt: new Date().toISOString(),
    };

    await redis.set(flagKey(name), JSON.stringify(record));
    return record;
  }

  async deleteFlag(name: string): Promise<void> {
    await redis.del(flagKey(name));
  }

  /**
   * Resolves whether a feature is enabled for the given user.
   *
   * - Missing flag, or `enabled: false` -> disabled.
   * - `enabled: true` with no `rolloutPercentage` (or `>= 100`) -> enabled for everyone.
   * - `rolloutPercentage <= 0` -> disabled for everyone.
   * - Otherwise, enabled for the deterministic subset of `userId`s that hash into
   *   the rollout bucket. A request with no `userId` is treated as not in the
   *   rollout, since there's no stable identity to gate on.
   */
  async isEnabled(name: string, userId?: string): Promise<boolean> {
    const flag = await this.getFlag(name);
    if (!flag || !flag.enabled) {
      return false;
    }

    const rollout = flag.rolloutPercentage;
    if (rollout === undefined || rollout >= 100) {
      return true;
    }
    if (rollout <= 0) {
      return false;
    }
    if (!userId) {
      return false;
    }

    return hashToBucket(`${name}:${userId}`) < rollout;
  }
}

export const featureFlagService = new FeatureFlagService();
