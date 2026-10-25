export const DATABASE_QUERY_TIMEOUT_MS = 5_000;

type TransactionCapable<TDatabase> = TDatabase & {
  $transaction?: <TResult>(
    operation: (transaction: TDatabase) => Promise<TResult>,
    options: { maxWait: number; timeout: number },
  ) => Promise<TResult>;
};

/**
 * Run related reads in an interactive transaction so Prisma cancels the work
 * when it exceeds the service's database time budget. The fallback keeps
 * lightweight test doubles usable without weakening production behaviour.
 */
export function withDatabaseQueryTimeout<TDatabase, TResult>(
  database: TransactionCapable<TDatabase>,
  operation: (transaction: TDatabase) => Promise<TResult>,
): Promise<TResult> {
  if (!database.$transaction) {
    return operation(database);
  }

  return database.$transaction(operation, {
    maxWait: DATABASE_QUERY_TIMEOUT_MS,
    timeout: DATABASE_QUERY_TIMEOUT_MS,
  });
}
