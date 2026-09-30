/**
 * =========================================================
 *  PM2 — Habibih Cloud ID
 *  File ini ikut ter-deploy agar env konsisten & stabil
 *  setelah auto-deploy GitHub Actions.
 * =========================================================
 */

module.exports = {
  apps: [
    {
      name: 'habi-api-web',
      script: './server.js',
      cwd: '/home/deploy/apps/habi-api-web',
      instances: 1,
      autorestart: true,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: '8080',
        HOST: '0.0.0.0',

        // Backend REST API (proxy)
        UPSTREAM_API: 'http://140.245.32.37:3000',
        UPSTREAM_TIMEOUT_MS: '180000',

        // yt-dlp untuk endpoint native
        YTDLP_PATH: '/home/deploy/bin/yt-dlp',
        YTDLP_TIMEOUT_MS: '120000',
        LOG_NATIVE: '1',

        // Identitas situs
        SITE_PUBLIC_URL: 'https://api.habibicloudserver.dpdns.org',
        SITE_NAME: 'HABI API',
        SITE_TAGLINE: 'Downloader & Tools REST API',
        OWNER_NAME: 'Habibih Cloud Official ID',
        OWNER_WA: '6285181576338',
        OWNER_WEBSITE: 'https://habibi-store.pages.dev',
        SUPPORT_WA: '6285181576338',
        GROUP_LINK: 'https://chat.whatsapp.com/L8UUutSeDK68LsHf0SXekh',
        FREE_QUOTA_TEXT: '25 req/hari',
      },
    },
  ],
}
