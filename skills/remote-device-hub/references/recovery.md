# Failure recovery and account allowance

For an authorized change, if the device advertises operation receipts and the
host exposes `prepare_operation`, reserve an ID for a supported operation and
pass the returned `operation_id` to that change. Never invent an ID or use an
expired one. This is optional when the device or routing does not support it.
After a timeout or disconnect, use `get_operation_status` with the original
device and operation ID, or inspect `list_operations` when the returned ID was
lost. Correlate a listed receipt before attributing it to the attempted change.
These queries do not repeat the operation, and their summaries may not contain
file content or process output.

For an ordinary device call without an operation receipt, use `get_call_status`
with its `support_id`, or inspect `list_calls` when that ID was lost, if those
tools are available. These queries also do not execute the original call.
Device-scoped call history does not cover `list_devices`; use its support ID in
the account activity view instead. An `unknown` outcome remains uncertain:
inspect the actual device state before considering a new change.

- Authentication failure: ask the user to reconnect through the host. In
  DeepSeek Harness the bundle starts browser sign-in through its OAuth bridge;
  if no browser opens, ask the user to restart the plugin and check the Harness
  logs. Do not request or replay OAuth credentials manually.
- Device missing, offline, or revoked: refresh `list_devices`; explain the
  observed state. Do not switch devices or attempt another identity.
- Disabled feature or permission failure: explain the restriction. Do not use
  an alternate tool to bypass it. Changing permissions requires a separate,
  explicit user request and the device owner's supported management flow.
- Timeout or disconnect after a write or command: the operation may already
  have executed. Inspect the relevant file or known job before considering a
  retry. If its outcome cannot be established, state that it is unknown and
  ask before another potentially duplicate side effect.
- Busy service: a read may be retried with bounded backoff. A write requires
  evidence that it was not dispatched, or state inspection as described above.
- Connection failure on a read-only call: wait briefly and retry at most once
  using the same device, path, and bounded arguments. If it still fails, report
  the failure and stop; do not fabricate content or switch to Shell.
- Read argument validation failure: check the tool schema and correct the
  rejected field once. For `read_file`, omit `length` or use 1..65536 bytes;
  do not repeat an invalid 1048576-byte length. This permits a corrected read,
  not retrying a potentially dispatched write or command.
- Stale file hash: reread, reconcile the newer content, and preserve other edits.
- Unsupported extended tool: use a supported equivalent only if it preserves
  the same permissions and semantics. Do not substitute shell for a denied read
  or write.
- `payment_required`: this error code means the current account
  allowance does not permit the operation. Stop retrying. `get_billing_status`
  is free and may report existing entitlement and remaining allowance. Explain
  those facts without promoting upgrades, presenting subscription plans,
  initiating checkout, or following a `payment_url` from an older server.

Do not promise a refund or a free retry: a dispatched operation with an unknown
outcome may consume allowance. Do not fabricate results when authentication,
quota, availability, or a permission boundary prevents execution.
