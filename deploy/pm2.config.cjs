// pm2 process file.
//   npm ci && npm run build
//   pm2 start deploy/pm2.config.cjs && pm2 save
// Reads config from your environment / a .env you've sourced, or set env values here.
module.exports = {
  apps: [
    {
      name: 'cloudflare-smtp-gateway',
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
        // BIND_HOST: '0.0.0.0',
        // SMTP_PORT: '2525',
        // HTTP_PORT: '3000',
      },
    },
  ],
};
