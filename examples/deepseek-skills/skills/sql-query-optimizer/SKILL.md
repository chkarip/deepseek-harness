---
name: sql-query-optimizer
description: Analyze SQL queries, resolve slow join conditions, recommend database indexes (B-tree, GIN), and rewrite subqueries. Use when diagnosing SQL database query performance, optimizing execution plans, recommending table indexes, or choosing B-tree and GIN indexing strategies for database tables.
---

# SQL Query Optimization Workflow

Follow this procedure when optimizing database queries:

1. **Examine Execution Plan**: Look for `Seq Scan`, nested loops with high row estimates, and high disk I/O.
2. **Index Recommendations**: Suggest composite or covering indexes matching filter and sort clauses.
3. **Query Refactoring**:
   - Replace correlated subqueries with `JOIN` or CTEs.
   - Avoid `SELECT *` — project only required columns.
   - Use `UNION ALL` instead of `UNION` when duplicates are impossible.
