module.exports = {
  apps: [
    {
      name: 'tangkayscan-api',
      script: './dist/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'tangkayscan-worker',
      script: './dist/workers/workerEntry.js',
      instances: 1,
      autorestart: true,
      watch: false,
      env: { NODE_ENV: 'production' },
    },
  ],
};
