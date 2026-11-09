# Audited grant lifecycle checks

The disposable PostgreSQL lifecycle inserts one service-company grant under
titan_config_grant_writer, sets an audit actor from trusted server context,
revokes the grant by incrementing its revision, checks read-only visibility
under titan_config_grant_reader, and asserts two audit entries. It cleans
only its own fixture rows in CI.

This is stronger than mocks: SQL privileges and trigger execution are real.
It is not proof that a production end-user or service can access the grant
writer role; real authentication and database credentials remain a blocker.
