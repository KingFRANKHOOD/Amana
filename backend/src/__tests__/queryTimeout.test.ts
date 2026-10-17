import {
  DATABASE_QUERY_TIMEOUT_MS,
  withDatabaseQueryTimeout,
} from "../lib/queryTimeout";

describe("withDatabaseQueryTimeout", () => {
  it("configures Prisma transactions with a five-second maximum", async () => {
    const database: any = { value: 42 };
    database.$transaction = jest.fn((operation) => operation(database));

    const result = await withDatabaseQueryTimeout(database, async (transaction) => transaction.value);

    expect(result).toBe(42);
    expect(database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: DATABASE_QUERY_TIMEOUT_MS,
      timeout: 5_000,
    });
  });
});
