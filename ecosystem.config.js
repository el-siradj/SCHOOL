# PM2 Ecosystem Configuration
# استخدم: pm2 start ecosystem.config.js

module.exports = {
    apps: [{
        name: 'school-notify-backend',
        script: './src/server.js',
        cwd: '/path/to/api.crshc.com',  // غيّر هذا المسار
        instances: 2,  // أو 'max' للاستفادة من جميع النوى
        exec_mode: 'cluster',
        env: {
            NODE_ENV: 'production',
            PORT: 3000
        },
        error_file: './logs/pm2-error.log',
        out_file: './logs/pm2-out.log',
        log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
        merge_logs: true,
        max_memory_restart: '500M',
        autorestart: true,
        watch: false,
        max_restarts: 10,
        min_uptime: '10s',
        listen_timeout: 10000,
        kill_timeout: 5000,
    }]
};
