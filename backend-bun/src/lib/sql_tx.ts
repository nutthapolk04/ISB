import type { Sql, TransactionSql } from "postgres";

/**
 * postgres-js tagged-template client — either the pool `Sql` or the
 * `TransactionSql` passed to `pgClient.begin(async (sqlTx) => …)`.
 */
export type SqlTx = Sql | TransactionSql;
