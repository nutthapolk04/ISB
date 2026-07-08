// PM2 process config.
//
// Runs the frontend Vite dev server through Bun (not Node). PM2's own daemon
// runs on Node, but each app here is executed by Bun directly via
// `interpreter: "none"` + an absolute path to the bun binary.
//
// Usage (from repo root):
//   pm2 start ecosystem.config.cjs      # start
//   pm2 logs isb-frontend               # tail logs
//   pm2 restart isb-frontend            # restart
//   pm2 stop isb-frontend               # stop
//   pm2 delete isb-frontend             # remove from pm2
//   pm2 save                            # persist process list across reboots
//
// Prereq: local database is up — `docker compose up -d`.

module.exports = {
  apps: [
    {
      name: "isb-backend",
      cwd: "./backend-bun",
      // `bun run dev` -> `bun --hot src/index.ts`. Already a .ts run by Bun,
      // so no --bun flag needed. Reads backend-bun/.env (cwd-local).
      script: "/opt/homebrew/bin/bun",
      args: "run dev",
      interpreter: "none",
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "development",
      },
    },
    {
      name: "isb-frontend",
      cwd: "./frontend",
      // Execute the bun binary directly; interpreter "none" stops PM2 from
      // wrapping the script with Node. The `--bun` flag forces Vite to run on
      // the Bun runtime instead of falling back to Node via its shebang.
      script: "/opt/homebrew/bin/bun",
      args: "--bun run dev",
      interpreter: "none",
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "development",
      },
    },
  ],
};
