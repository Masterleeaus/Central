# Concurrent writer verification

The configuration CI provisions a disposable PostgreSQL 16 service.
The first SQL session locks the scope and commits revision one plus its audit.
The second session attempts to write using stale revision zero, waits for
the row lock and must fail. The final assertion requires exactly one revision,
one audit record, and a head revision of one.

This validates the PostgreSQL row lock protocol under a two-client example.
It does not prove throughput, deadlock freedom, general API correctness, or
tenant row-level security. No production database is involved.
