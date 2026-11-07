# File and Shared-Session Safety Reference

> Path note: this file is addressed from `SKILL.md` as `./references/file-session-safety.md` and must be resolved relative to the directory containing that loaded `SKILL.md`.

Load this reference only for tasks involving file creation or modification, name collisions, MATLAB test files, shared-session variables, plots and figures, or recovery after errors.

## Shared MATLAB session

Assume the active session may contain valuable user state:

- variables;
- current folder;
- paths;
- RNG state;
- open figures;
- toolbox or application state.

Do not use `clear`, `clearvars`, `clear all`, `clc`, `close all`, or restart MATLAB unless the user explicitly requests it and the action is necessary.

An execution error is not a reason to clear or restart the session. Report the error and preserve unrelated state.

When cross-call persistence matters, verify it with separate MCP calls.

## File creation workflow

Default to non-destructive behavior:

1. determine the intended absolute path;
2. use MATLAB `isfile`, `isfolder`, or the appropriate test before writing;
3. if the preferred name exists and overwrite is not authorized, select the first unused suffix such as `_1`, `_2`, and so on;
4. create the file once the final path is known;
5. verify that the final file exists;
6. return the actual absolute path.

Do not overwrite, delete, rename, or modify an existing file without explicit authorization.

## Test-file naming

For MATLAB function-based unit tests:

- the primary test-function name must match the final `.m` filename;
- if a collision changes the filename, change the primary function name too;
- run the file using the exposed `run_matlab_test_file` capability;
- report Passed, Failed, and Incomplete counts from the actual result.

## Plot and figure safety

Prefer function-based examples that keep variables local.

- Use an invisible figure for noninteractive output unless the user requests a visible plot.
- Use `onCleanup` or another reliable mechanism to close only the figure created by the task.
- Do not call `close all` in a shared session.
- Check the destination before exporting.
- Return the actual output path.

## Static analysis

Static-analysis requests are read-only:

- use the exposed `check_matlab_code` capability;
- do not execute the file;
- do not modify the file;
- do not add unrelated project reads unless the user asked for broader inspection.

## Existing scripts and faulty code

When the user asks to run an existing file unchanged, use its absolute path and do not rewrite it silently.

When the user asks to run faulty code unchanged:

1. run it unchanged;
2. return the genuine MATLAB error;
3. keep any repair separate and clearly labeled;
4. do not present the repaired run as the original result.

## Verification after writes

For important artifacts, verify more than existence when appropriate:

- reload MAT-file contents;
- check expected variables or dimensions;
- verify image or report path;
- run the generated test file;
- compare a sentinel value when testing overwrite protection.

Use the narrowest verification required by the task. Do not add unrelated file inspection.
