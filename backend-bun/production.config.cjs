// PM2 process config for production.
//
// `.cjs` (not `.js`) is required: backend-bun/package.json sets
// "type": "module", so a plain `.js` file here would be loaded as ESM and
// `module.exports` below would throw. `.cjs` forces CommonJS regardless.
//
// Usage (from backend-bun/):
//   bun run prod:start     # build + pm2 start
//   bun run prod:logs      # tail logs
//   bun run prod:restart   # rebuild + restart
//   bun run prod:stop      # stop
//
// Prereq: `bun run build` must have produced ./dist/server.js.

module.exports = {
    apps: [
        {
            name: "isb-backend-production",
            cwd: __dirname,
            script: "/opt/homebrew/bin/bun",
            args: "run ./dist/server.js",
            interpreter: "none",
            autorestart: true,
            watch: false,
            env: {
                NODE_ENV: "production",
            },
            out_file: "./logs/pm2-out.log",
            error_file: "./logs/pm2-error.log",
            max_memory_restart: '700M',
        },
    ],
};
