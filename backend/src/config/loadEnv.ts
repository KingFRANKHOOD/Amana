import dotenv from 'dotenv';
import path from 'path';

/**
 * Load `.env` from the backend working directory before config validation runs.
 * Import this module once at the application entry point, before `./env`.
 */
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
