import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['tests/**/*.test.js'],
    poolOptions: {
      workers: {
        wrangler: { configPath: '../wrangler.toml' },
        miniflare: {
          kvNamespaces: ['WHITELIST', 'adtools', 'ANALYTICS'],
          d1Databases: ['DB'],
          r2Buckets: ['UPDATES'],
        },
      },
    },
  },
});
