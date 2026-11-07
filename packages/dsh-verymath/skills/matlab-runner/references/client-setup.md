# Coding-agent setup

Use this reference only when installing or connecting the skill.

1. Place the complete `matlab-runner` directory in a location from which the
   coding agent can load skills, or register its canonical `SKILL.md` using the
   client's supported skill mechanism.
2. Configure a compatible MATLAB MCP Server using that coding agent's MCP
   configuration mechanism. Keep executable paths and local MATLAB settings in
   client configuration, not in this package.
3. Restart or reload the client if its tool catalog is cached.
4. Confirm that the client exposes the MATLAB capability needed by the task,
   such as evaluation, file execution, unit testing, static analysis, or
   toolbox detection.
5. Let the coding agent inspect the exposed tools, compare descriptions and
   parameter schemas, and call the actual tool name shown by that client.

Different clients may expose the same capability as a bare name, a
server-prefixed name, or a namespaced name. The adapter intentionally does not
hard-code one spelling or installation directory.

MATLAB, its license, and the MCP server are separate prerequisites. Do not
install, reconfigure, or replace them automatically unless the user explicitly
requests environment setup.
