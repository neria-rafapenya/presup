module.exports = {
  apps: [
    {
      name: "horekia-poc",
      cwd: "/var/www/horekia/presup",
      script: "/var/www/horekia/presup/.venv/bin/uvicorn",
      args: "services.api.app.main:app --host 127.0.0.1 --port 8010",
      interpreter: "none",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "500M",
      kill_timeout: 10000,
      time: true,
    },
  ],
};
