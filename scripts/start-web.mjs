#!/usr/bin/env node
/**
 * Production start for hosted web services (Render, etc.).
 * Binds 0.0.0.0 and honors PORT from the host. Local sandbox preview is unchanged.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = String(process.env.PORT || "10000");

const child = spawn(
  process.execPath,
  ["scripts/with-app-env.mjs", "vite", "preview", "--host", "0.0.0.0", "--port", port, "--strictPort", "false"],
  { cwd: root, stdio: "inherit", env: process.env },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
