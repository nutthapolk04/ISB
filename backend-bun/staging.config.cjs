// PM2 process config for staging.
//
// `.cjs` (not `.js`) is required: backend-bun/package.json sets
// "type": "module", so a plain `.js` file here would be loaded as ESM and
// `module.exports` below would throw. `.cjs` forces CommonJS regardless.
//
// NODE_ENV is "production" (not "staging") on purpose: config.ts only
// branches on "development" vs "production" (e.g. the CORS_ORIGINS
// requirement) — there is no "staging" case, so staging should mirror
// production's strict behavior rather than fall back to dev defaults.
//
// Usage (from backend-bun/):
//   bun run staging:start     # build + pm2 start
//   bun run staging:logs      # tail logs
//   bun run staging:restart   # rebuild + restart
//   bun run staging:stop      # stop
//
// Prereq: `bun run build` must have produced ./dist/server.js.

module.exports = {
    apps: [
        {
            name: "isb-backend-staging",
            cwd: __dirname,
            script: "/opt/homebrew/bin/bun",
            args: "run ./dist/server.js",
            interpreter: "none",
            autorestart: true,
            watch: false,
            env: {
                NODE_ENV: "production",
                APP_ENV: "uat",
            },
            out_file: "./logs/pm2-staging-out.log",
            error_file: "./logs/pm2-staging-error.log",
            max_memory_restart: '700M',
        },
    ],
};
