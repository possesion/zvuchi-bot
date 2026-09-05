'use strict';

const http = require('node:http');
const https = require('node:https');
const logger = require('./logger');
const Database = require('better-sqlite3');

// In-memory alert state — сбрасывается только при успешном healthcheck
let alertSent = false;

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
 * Отправляет алерт в Telegram через Alert Bot.
 * Использует node:https напрямую, без npm-пакетов.
 * @param {string} message - описание ошибки
 */
function sendAlert(message) {
    const token = process.env.ALERT_BOT_TOKEN;
    const chatId = process.env.ALERT_CHAT_ID;

    if (!token || !chatId) {
        logger.warn('[healthcheck] ALERT_BOT_TOKEN или ALERT_CHAT_ID не заданы — алерт пропущен');
        return;
    }

    const body = JSON.stringify({
        chat_id: chatId,
        text: `[Zvuchi Bot] Сбой при healthcheck: ${message}`
    });

    const options = {
        hostname: 'api.telegram.org',
        path: `/bot${token}/sendMessage`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
        }
    };

    const req = https.request(options, (res) => {
        if (res.statusCode !== 200) {
            logger.error(`[healthcheck] Ошибка отправки алерта: HTTP ${res.statusCode}`);
        }
    });

    req.on('error', (e) => logger.error('[healthcheck] Ошибка HTTPS при отправке алерта:', e.message));
    req.write(body);
    req.end();
}

/**
 * Обрабатывает GET /healthcheck:
 * - вызывает checkTelegramApi()
 * - при успехе сбрасывает alertSent, отвечает 200
 * - при сбое отправляет однократный алерт, отвечает 503
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handleHealthcheck(req, res) {
    try {
        await checkTelegramApi();

        if (alertSent) {
            alertSent = false;
            logger.info('[healthcheck] Восстановление после сбоя — Alert State сброшен');
        }

        logger.info('[healthcheck] OK');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
    } catch (err) {
        const message = err.message || String(err);

        if (!alertSent) {
            sendAlert(message);
            alertSent = true;
        }

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
