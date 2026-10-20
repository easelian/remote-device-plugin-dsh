# File operations

Use `list_directory` with `next_offset` for browsing. Prefer `file_info` for
metadata when the Agent advertises it. Prefer bounded `read_file` calls for
content; use `read_multiple_files` or `read_file_chunk` only when supported.
Read offsets and lengths are bytes. For `read_file` and `read_file_chunk`, omit
`length` to use 32768 bytes, or choose 1..65536 (64 KiB) per call. The 1 MiB
`read_file` file-size limit is not a per-call length: never pass 1048576 as
`length`. Start at offset 0 and follow `next_offset` while `truncated` is true;
stop once complete or once the requested scope is satisfied. Do not loop merely
because the final `next_offset` is a number. Preserve pagination information and
explain when the result is incomplete. Do not request secret files for an unrelated task.

For a new file, call `write_file` with an empty `expected_sha256`; this means
create-only. For an existing file, first read its current contents and SHA-256,
then use that exact hash with `write_file` or `edit_file`. `edit_file` requires
one exact match. If the hash is stale or the match is ambiguous, reread and
reconcile with the requested change. Never retry an overwrite with an empty hash.
Read the changed file back before reporting that its content matches the task.

`make_directory` creates one directory whose parent already exists.
`move_file`, when supported, moves within a named root. Check the source and
destination and disclose the intended move. There is no dedicated delete-file
tool; do not claim one exists. A deletion implemented by a shell command is a
separate, potentially irreversible shell operation requiring the relevant
authorization and enabled capabilities.

Use literal `search_files` for a small bounded search. For supported Agents,
`start_search`, `get_search_results`, `list_searches`, and `stop_search` manage
an asynchronous search. Follow result offsets and report truncation. Stopping
a search changes its state; do it only when the task calls for cancellation.
