import { env } from './env';
import { appLogger } from '../middleware/logger';

/**
 * Environment variable validation result
 */
export interface EnvValidationResult {
  valid: boolean;
  missing: string[];
  invalid: string[];
}

/**
 * Environment variable categories
 */
export enum EnvVarCategory {
  CRITICAL = 'critical',     // App cannot start without these
  REQUIRED = 'required',     // Core functionality broken without these
  OPTIONAL = 'optional',     // Nice to have but app can run
}

/**
 * Environment variable definition
 */
export interface EnvVarDefinition {
  name: string;
  category: EnvVarCategory;
  description: string;
  validator?: (value: string) => boolean;
}

/**
 * Centralized environment variable validator
 * Fails fast when critical variables are missing
 */
export class EnvValidator {
  private static definitions: EnvVarDefinition[] = [
    // Critical - app cannot start
    {
      name: 'DATABASE_URL',
      category: EnvVarCategory.CRITICAL,
      description: 'PostgreSQL database connection string',
    },
    {
      name: 'JWT_SECRET',
      category: EnvVarCategory.CRITICAL,
      description: 'Secret key for JWT token signing (min 32 chars)',
      validator: (value) => value.length >= 32,
    },
    {
      name: 'AMANA_ESCROW_CONTRACT_ID',
      category: EnvVarCategory.CRITICAL,
      description: 'Stellar escrow contract ID',
    },
    {
      name: 'USDC_CONTRACT_ID',
      category: EnvVarCategory.CRITICAL,
      description: 'Stellar USDC contract ID',
    },
    {
      name: 'STELLAR_NETWORK',
      category: EnvVarCategory.CRITICAL,
      description: 'Stellar network (mainnet or testnet)',
      validator: (value) => ['mainnet', 'testnet'].includes(value.toLowerCase()),
    },

    // Required - core functionality broken
    {
      name: 'STELLAR_RPC_URL',
      category: EnvVarCategory.REQUIRED,
      description: 'Stellar Soroban RPC URL',
    },
    {
      name: 'REDIS_URL',
      category: EnvVarCategory.REQUIRED,
      description: 'Redis connection URL',
    },

    // Optional - nice to have
    {
      name: 'PINATA_API_KEY',
      category: EnvVarCategory.OPTIONAL,
      description: 'Pinata API key for IPFS uploads',
    },
    {
      name: 'PINATA_SECRET',
      category: EnvVarCategory.OPTIONAL,
      description: 'Pinata secret for IPFS uploads',
    },
    {
      name: 'SUPABASE_URL',
      category: EnvVarCategory.OPTIONAL,
      description: 'Supabase URL for additional services',
    },
    {
      name: 'SUPABASE_SERVICE_ROLE_KEY',
      category: EnvVarCategory.OPTIONAL,
      description: 'Supabase service role key',
    },
    {
      name: 'WEBHOOK_URL',
      category: EnvVarCategory.OPTIONAL,
      description: 'Webhook URL for event notifications',
    },
    {
      name: 'WEBHOOK_SECRET',
      category: EnvVarCategory.OPTIONAL,
      description: 'Webhook secret for signature verification',
    },
  ];

  /**
   * Validate all environment variables
   * Returns validation result with missing/invalid variables
   */
  static validate(): EnvValidationResult {
    const missing: string[] = [];
    const invalid: string[] = [];

    for (const def of this.definitions) {
      const value = process.env[def.name];

      // Check if missing
      if (!value) {
        if (def.category === EnvVarCategory.CRITICAL) {
          missing.push(def.name);
        }
        continue;
      }

      // Run custom validator if provided
      if (def.validator && !def.validator(value)) {
        invalid.push(def.name);
      }
    }

    return {
      valid: missing.length === 0 && invalid.length === 0,
      missing,
      invalid,
    };
  }

  /**
   * Validate and fail fast if critical variables are missing
   * Throws an error with detailed information if validation fails
   */
  static validateOrFail(): void {
    const result = this.validate();

    if (!result.valid) {
      const errors: string[] = [];

      if (result.missing.length > 0) {
        errors.push(`Missing critical environment variables: ${result.missing.join(', ')}`);
      }

      if (result.invalid.length > 0) {
        errors.push(`Invalid environment variables: ${result.invalid.join(', ')}`);
      }

      const errorMessage = errors.join('; ');
      
      appLogger.error(
        { 
          missing: result.missing, 
          invalid: result.invalid,
          definitions: this.definitions.filter(d => 
            result.missing.includes(d.name) || result.invalid.includes(d.name)
          )
        },
        'Environment validation failed'
      );

      throw new Error(`Environment validation failed: ${errorMessage}`);
    }

    appLogger.info('Environment validation passed');
  }

  /**
   * Get all environment variable definitions
   */
  static getDefinitions(): EnvVarDefinition[] {
    return [...this.definitions];
  }

  /**
   * Get environment variable definition by name
   */
  static getDefinition(name: string): EnvVarDefinition | undefined {
    return this.definitions.find(def => def.name === name);
  }

  /**
   * Validate a single environment variable
   */
  static validateVar(name: string): { valid: boolean; error?: string } {
    const def = this.getDefinition(name);
    if (!def) {
      return { valid: true }; // Unknown vars are not validated
    }

    const value = process.env[name];
    if (!value) {
      if (def.category === EnvVarCategory.CRITICAL) {
        return { valid: false, error: `Missing critical variable: ${name}` };
      }
      return { valid: true }; // Optional vars can be missing
    }

    if (def.validator && !def.validator(value)) {
      return { valid: false, error: `Invalid value for ${name}: ${def.description}` };
    }

    return { valid: true };
  }

  /**
   * Get current environment configuration summary
   */
  static getConfigSummary(): Record<string, string> {
    const summary: Record<string, string> = {};

    for (const def of this.definitions) {
      const value = process.env[def.name];
      if (value) {
        // Mask sensitive values
        if (def.name.includes('SECRET') || def.name.includes('KEY') || def.name.includes('PASSWORD')) {
          summary[def.name] = '***MASKED***';
        } else {
          summary[def.name] = value;
        }
      } else {
        summary[def.name] = def.category === EnvVarCategory.CRITICAL ? 'MISSING' : 'NOT_SET';
      }
    }

    return summary;
  }
}

/**
 * Validate environment at startup
 * Call this in your application entry point (e.g., index.ts)
 */
export function validateEnvironment(): void {
  try {
    EnvValidator.validateOrFail();
  } catch (error) {
    appLogger.error({ error }, 'Failed to validate environment at startup');
    throw error; // Re-throw to prevent app startup
  }
}
