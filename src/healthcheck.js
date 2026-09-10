'use strict';

const http = require('node:http');
const logger = require('./logger');
const Database = require('better-sqlite3');

/**
 * Проверяет доступность Telegram API через метод getMe.
 * Бросает ошибку при любом сбое: сетевом, таймауте, non-ok статусе или ok=false в теле.
 */
async function checkTelegramApi() {
    const token = process.env.API_KEY_BOT;
    const url = `https://api.telegram.org/bot${token}/getMe`;

    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });

    if (!res.ok) {
        throw new Error(`Telegram getMe вернул HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data.ok) {
        throw new Error(`Telegram getMe: ok=false, ${JSON.stringify(data)}`);
    }
}

/**
 * Обрабатывает GET /healthcheck:
 * - вызывает checkTelegramApi()
 * - при успехе отвечает 200
 * - при сбое отвечает 503
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handleHealthcheck(req, res) {
    try {
        await checkTelegramApi();

        logger.info('[healthcheck] OK');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
    } catch (err) {
        const message = err.message || String(err);

        logger.error(`[healthcheck] ОШИБКА: ${message}`);
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message }));
    }
}

/**
 * Обрабатывает GET /users:
 * - извлекает всех пользователей из БД
 * - возвращает компактный список в формате ключ:значение
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
function handleUsers(req, res) {
    try {
        const db = new Database('bot.db');
        const stmt = db.prepare('SELECT user_id, phone_number, created_at, notify, next_lesson_date, scheduled_at, sent, name, paid_count FROM users');
        const rows = stmt.all();
        db.close();

        logger.info(`[users] Возвращено пользователей: ${rows.length}`);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ total: rows.length, users: rows }, null, 2));
    } catch (err) {
        const message = err.message || String(err);
        logger.error(`[users] ОШИБКА: ${message}`);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ status: 'error', message }));
    }
}

/**
 * Обрабатывает GET /sync:
 * - запускает синхронизацию расписания для всех подписчиков
 * - возвращает результат синхронизации
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {import('node-telegram-bot-api')} bot
 */
async function handleSync(req, res, bot) {
    try {
        const { syncSchedule } = require('./notifications');
        logger.info('[sync] Запуск синхронизации расписания');
        
        await syncSchedule(bot);
        
        logger.info('[sync] Синхронизация завершена');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ status: 'ok', message: 'Синхронизация расписания завершена' }));
    } catch (err) {
        const message = err.message || String(err);
        logger.error(`[sync] ОШИБКА: ${message}`, { stack: err.stack });
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ status: 'error', message }));
    }
}

/**
 * Запускает HTTP-сервер для healthcheck.
 * @param {import('node-telegram-bot-api')} bot - экземпляр бота для эндпоинта /sync
 * @param {number} [port] - порт для прослушивания (по умолчанию HEALTHCHECK_PORT || 3000)
 * @returns {http.Server}
 */
function startHealthcheckServer(bot, port) {
    const listenPort = port || Number(process.env.HEALTHCHECK_PORT) || 3000;

    const server = http.createServer((req, res) => {
        if (req.url === '/healthcheck') {
            handleHealthcheck(req, res);
        } else if (req.url === '/users') {
            handleUsers(req, res);
        } else if (req.url === '/sync') {
            if (!bot) {
                res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ status: 'error', message: 'Bot instance not available' }));
                return;
            }
            handleSync(req, res, bot);
        } else {
            res.writeHead(404);
            res.end();
        }
    });

    server.listen(listenPort, () => {
        logger.info(`[healthcheck] HTTP-сервер слушает порт ${listenPort}`);
    });

    return server;
}

module.exports = { startHealthcheckServer };
