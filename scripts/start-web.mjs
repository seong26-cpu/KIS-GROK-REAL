#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = String(process.env.PORT || "10000");
const nitroServer = join(root, ".output/server/index.mjs");

const env = {
  ...process.env,
  HOST: process.env.HOST || "0.0.0.0",
  PORT: port,
  NITRO_HOST: process.env.NITRO_HOST || "0.0.0.0",
  NITRO_PORT: process.env.NITRO_PORT || port,
};

const child = existsSync(nitroServer)
  ? spawn(process.execPath, [nitroServer], { cwd: root, stdio: "inherit", env })
  : spawn(
      process.execPath,
      ["scripts/with-app-env.mjs", "vite", "preview", "--host", "0.0.0.0", "--port", port, "--strictPort", "false"],
      { cwd: root, stdio: "inherit", env },
    );

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
