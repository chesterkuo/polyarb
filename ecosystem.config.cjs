module.exports = {
  apps: [
    {
      name: "polyarb",
      script: "src/main.ts",
      interpreter: "bun",
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        DRY_RUN: "true",
      },
      env_production: {
        DRY_RUN: "false",
      },
      out_file: "./data/logs/polyarb-out.log",
      error_file: "./data/logs/polyarb-error.log",
    },
  ],
};
