# Verified PostgreSQL TLS in canonical upstream integration

The pinned company integration job generates a one-day self-signed TLS
certificate inside the disposable PostgreSQL 16 service and exports only
the CA certificate. The server private key remains inside the database
container. The actual signed-JWT HTTP and PostgreSQL integration now retains
verify-full and the CA path rather than deleting TLS query parameters.

Four separately authenticated service logins must establish encrypted
PostgreSQL connections and the backend's pg_stat_ssl view must report
an active TLS protocol and cipher. A bad CA is rejected. This is CI-only
verification, not a production CA or deployed credentials.
