# Grant writer operator authorization

The existing Central operator flow verifies the Logto user session and
checks live Logto organisation-admin authority. The new server-only grant
mutation service requires this trusted principal AND re-executes an injected
operator-authority check for each mutation.

A separate company authorization callback must check the canonical company
and product grant scope. No local profile, browser claim or email grants
operator authority. Every write obtains its audit actor from the verified
principal and strips all untrusted actor properties from commands.

This module does not wire a live HTTP route or assert that a full production
policy exists. Do not enable grant mutations without a real company
authorization policy and verified operator session.
