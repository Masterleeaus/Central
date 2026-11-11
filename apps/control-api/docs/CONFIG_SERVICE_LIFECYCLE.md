# Central configuration endpoint service lifecycle (Pass 23)

The actual HTTP listener is started only after the Central config runtime
has verified restricted SQL login identity, shared-company schema and the
approved SHA-256 migration receipt. It is bound to loopback only. Startup
configuration failures close main and restricted database pools.

Service shutdown is idempotent. HTTP close and all database pool closes are
attempted even if another close fails; failures are reported as AggregateError
without echoing connection secrets. The opt-in configuration endpoint stays
disabled unless its separately approved migration/credential policies pass.
Operational production deployment has NOT been performed.
