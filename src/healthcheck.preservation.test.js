/**
 * Preservation-тесты (Property 2): Success, Error Response, and Routing Unchanged
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4
 *
 * IMPORTANT: Эти тесты фиксируют корректное БАЗОВОЕ поведение healthcheck-сервера,
 * которое НЕ должно измениться после удаления самореферентного алерта (sendAlert /
 * alertSent). Они должны ПРОХОДИТЬ и на неисправленном, и на исправленном коде.
 *
 * Methodology: observation-first — тесты написаны на основе наблюдений за поведением
 * ОРИГИНАЛЬНОГО кода на входных данных ВНЕ баг-условия (isBugCondition === false):
 * успешный healthcheck, /users, /sync, неизвестные пути.
 *
 * Scope: мы утверждаем только про наблюдаемый контракт запрос→ответ→лог, который
 * сохраняется фиксом:
 *   - success   → 200 { status: 'ok' } + лог "[healthcheck] OK"
 *   - failure   → 503 { status: 'error', message } + лог "[healthcheck] ОШИБКА: <message>"
 *   - /users    → 200 со списком пользователей (500 при ошибке БД)
 *   - /sync     → 200 при успехе, 503 если бот отсутствует, 500 при ошибке
 *   - unknown   → 404
 *
 * NB: Мы НЕ утверждаем ничего про alert-побочные эффекты (https.request к
 * api.telegram.org, "Ошибка ... алерта", "Восстановление после сбоя") — они
 * удаляются фиксом. https.request здесь замокан только чтобы неисправленный
 * sendAlert() не делал реальных сетевых вызовов; ассертов по нему нет.
 */

'use strict';

const http = require('node:http');
const fc = require('fast-check');

// Мокаем logger, чтобы наблюдать лог-строки
jest.mock('./logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

// Мокаем БД для /users: конструктор Database управляется через mockUsersDbBehavior
let mockUsersDbBehavior = { mode: 'success', rows: [] };
jest.mock('better-sqlite3', () => {
    return jest.fn().mockImplementation(() => {
        if (mockUsersDbBehavior.mode === 'error') {
            throw new Error(mockUsersDbBehavior.message || 'DB open error');
        }
        return {
            prepare: () => ({ all: () => mockUsersDbBehavior.rows }),
            close: () => {},
        };
    });
});

// Мокаем notifications для /sync: syncSchedule управляется в каждом тесте
jest.mock('./notifications', () => ({
    syncSchedule: jest.fn(() => Promise.resolve()),
}));

let logger;
let notifications;
let https;
let requestSpy;

// Управляет поведением global.fetch (checkTelegramApi) для текущего запроса.
let fetchBehavior = { ok: true, message: null };

/**
 * Фейковый ClientRequest — чтобы неисправленный sendAlert() не делал реальных
 * сетевых вызовов. Ассертов по нему НЕТ (alert-побочки вне scope preservation).
 */
function makeFakeRequest() {
    return {
        on: jest.fn().mockReturnThis(),
        write: jest.fn(),
        end: jest.fn(),
    };
}

/**
 * GET-запрос к запущенному серверу; резолвит { statusCode, body }.
 */
function httpGet(port, path) {
    return new Promise((resolve, reject) => {
        const req = http.request(
            { hostname: '127.0.0.1', port, path, method: 'GET' },
            (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
            }
        );
        req.on('error', reject);
        req.end();
    });
}

/**
 * Уникальный порт на каждый сервер. startHealthcheckServer трактует 0 как falsy
 * (port || ... || 3000), поэтому выдаём возрастающие уникальные порты, чтобы
 * избежать коллизий/TIME_WAIT между тестами.
 */
let nextPort = 35071;

/**
 * Запускает healthcheck-сервер на уникальном порту и ждёт listening.
 * @param {object|null} bot - экземпляр бота (нужен для ветки /sync)
 */
function startServer(bot = null) {
    const { startHealthcheckServer } = require('./healthcheck');
    const port = nextPort++;
    const server = startHealthcheckServer(bot, port);
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        if (server.listening) return resolve(server);
        server.once('listening', () => resolve(server));
    });
}

function closeServer(server) {
    return new Promise((resolve) => server.close(resolve));
}

beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    logger = require('./logger');
    notifications = require('./notifications');
    https = require('node:https');
    requestSpy = jest.spyOn(https, 'request').mockImplementation(() => makeFakeRequest());

    process.env.API_KEY_BOT = 'test-bot-token';
    process.env.ALERT_BOT_TOKEN = 'alert-bot-token';
    process.env.ALERT_CHAT_ID = '123456';

    // Значения по умолчанию для управляемых зависимостей
    mockUsersDbBehavior = { mode: 'success', rows: [] };
    fetchBehavior = { ok: true, message: null };

    global.fetch = jest.fn(() => {
        if (fetchBehavior.ok) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
        }
        return Promise.reject(new Error(fetchBehavior.message));
    });
});

afterEach(() => {
    requestSpy.mockRestore();
    delete global.fetch;
});

// ---------------------------------------------------------------------------
// Property 2a: успешный healthcheck → 200 { status: 'ok' } + лог "[healthcheck] OK"
// ---------------------------------------------------------------------------

describe('Property 2a: успешный /healthcheck отвечает 200 { status: ok }', () => {
    /**
     * Validates: Requirements 3.1
     */
    test('Пример 2a: checkTelegramApi() успешен → 200 { status: ok } + лог OK', async () => {
        fetchBehavior = { ok: true, message: null };

        const server = await startServer();
        try {
            const port = server.address().port;
            const res = await httpGet(port, '/healthcheck');

            expect(res.statusCode).toBe(200);
            expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
            expect(logger.info).toHaveBeenCalledWith('[healthcheck] OK');
        } finally {
            await closeServer(server);
        }
    });

    /**
     * Validates: Requirements 3.1
     *
     * Property: повторные успешные запросы всегда дают идентичный ответ 200 —
     * результат зависит только от текущего запроса, не от накопленного состояния.
     */
    test('Property 2a: N успешных запросов подряд — каждый 200 { status: ok }', async () => {
        await fc.assert(
            fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (n) => {
                fetchBehavior = { ok: true, message: null };

                const server = await startServer();
                try {
                    const port = server.address().port;
                    for (let i = 0; i < n; i++) {
                        const res = await httpGet(port, '/healthcheck');
                        if (res.statusCode !== 200) return false;
                        if (JSON.parse(res.body).status !== 'ok') return false;
                    }
                    return true;
                } finally {
                    await closeServer(server);
                }
            }),
            { numRuns: 10, seed: 42 }
        );
    });
});

// ---------------------------------------------------------------------------
// Property 2b: неуспешный healthcheck → 503 { status:'error', message } + error-лог
// (форма ответа/лога, независимо от alert-побочек)
// ---------------------------------------------------------------------------

describe('Property 2b: неуспешный /healthcheck отвечает 503 { status: error, message }', () => {
    const failureCases = [
        { label: 'DNS failure', message: 'getaddrinfo EAI_AGAIN api.telegram.org' },
        { label: 'timeout', message: 'The operation was aborted due to timeout' },
        { label: 'AggregateError', message: 'fetch failed' },
        { label: '502', message: 'Telegram getMe вернул HTTP 502' },
    ];

    for (const { label, message } of failureCases) {
        /**
         * Validates: Requirements 3.2
         */
        test(`Пример 2b (${label}): 503 { status: error, message } + error-лог`, async () => {
            fetchBehavior = { ok: false, message };

            const server = await startServer();
            try {
                const port = server.address().port;
                const res = await httpGet(port, '/healthcheck');

                expect(res.statusCode).toBe(503);
                expect(JSON.parse(res.body)).toEqual({ status: 'error', message });
                expect(logger.error).toHaveBeenCalledWith(`[healthcheck] ОШИБКА: ${message}`);
            } finally {
                await closeServer(server);
            }
        });
    }

    /**
     * Validates: Requirements 3.2
     *
     * Property: для ЛЮБОГО непустого сообщения сбоя ответ = 503 с
     * { status: 'error', message } и логируется "[healthcheck] ОШИБКА: <message>".
     */
    test('Property 2b: для любого сообщения сбоя — 503 { status: error, message } + error-лог', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0),
                async (message) => {
                    jest.clearAllMocks();
                    requestSpy.mockImplementation(() => makeFakeRequest());
                    fetchBehavior = { ok: false, message };

                    const server = await startServer();
                    try {
                        const port = server.address().port;
                        const res = await httpGet(port, '/healthcheck');

                        const body = JSON.parse(res.body);
                        const shapeOk =
                            res.statusCode === 503 &&
                            body.status === 'error' &&
                            body.message === message;
                        const logged = logger.error.mock.calls.some(
                            (c) => String(c[0]) === `[healthcheck] ОШИБКА: ${message}`
                        );
                        return shapeOk && logged;
                    } finally {
                        await closeServer(server);
                    }
                }
            ),
            { numRuns: 15, seed: 42 }
        );
    });

    /**
     * Validates: Requirements 3.1, 3.2
     *
     * Property: форма ответа зависит ТОЛЬКО от текущего запроса, а не от
     * накопленного состояния. Произвольная последовательность success/failure
     * даёт для каждого запроса ответ, соответствующий его собственному исходу.
     */
    test('Property 2b: смешанная последовательность — ответ зависит только от текущего запроса', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(
                    fc.oneof(
                        fc.constant({ ok: true }),
                        fc
                            .string({ minLength: 1, maxLength: 30 })
                            .filter((s) => s.trim().length > 0)
                            .map((message) => ({ ok: false, message }))
                    ),
                    { minLength: 1, maxLength: 6 }
                ),
                async (sequence) => {
                    const server = await startServer();
                    try {
                        const port = server.address().port;
                        for (const step of sequence) {
                            fetchBehavior = step.ok
                                ? { ok: true, message: null }
                                : { ok: false, message: step.message };

                            const res = await httpGet(port, '/healthcheck');

                            if (step.ok) {
                                if (res.statusCode !== 200) return false;
                                if (JSON.parse(res.body).status !== 'ok') return false;
                            } else {
                                const body = JSON.parse(res.body);
                                if (res.statusCode !== 503) return false;
                                if (body.status !== 'error' || body.message !== step.message) return false;
                            }
                        }
                        return true;
                    } finally {
                        await closeServer(server);
                    }
                }
            ),
            { numRuns: 15, seed: 42 }
        );
    });
});

// ---------------------------------------------------------------------------
// Property 2c: /users → 200 со списком пользователей (500 при ошибке БД)
// ---------------------------------------------------------------------------

describe('Property 2c: /users возвращает 200 со списком (500 при ошибке БД)', () => {
    /**
     * Validates: Requirements 3.3
     */
    test('Пример 2c: /users → 200 { total, users }', async () => {
        mockUsersDbBehavior = {
            mode: 'success',
            rows: [
                { user_id: 1, phone_number: '79001112233', notify: 1 },
                { user_id: 2, phone_number: '79004445566', notify: 0 },
            ],
        };

        const server = await startServer();
        try {
            const port = server.address().port;
            const res = await httpGet(port, '/users');

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.total).toBe(2);
            expect(body.users).toHaveLength(2);
        } finally {
            await closeServer(server);
        }
    });

    /**
     * Validates: Requirements 3.3
     *
     * Property: для любого набора строк /users отвечает 200, а total совпадает
     * с числом строк.
     */
    test('Property 2c: /users → 200 и total === числу строк', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(
                    fc.record({
                        user_id: fc.integer({ min: 1, max: 1_000_000 }),
                        phone_number: fc.stringMatching(/^7\d{10}$/),
                        notify: fc.constantFrom(0, 1),
                    }),
                    { minLength: 0, maxLength: 10 }
                ),
                async (rows) => {
                    mockUsersDbBehavior = { mode: 'success', rows };

                    const server = await startServer();
                    try {
                        const port = server.address().port;
                        const res = await httpGet(port, '/users');
                        const body = JSON.parse(res.body);
                        return res.statusCode === 200 && body.total === rows.length;
                    } finally {
                        await closeServer(server);
                    }
                }
            ),
            { numRuns: 15, seed: 42 }
        );
    });

    /**
     * Validates: Requirements 3.3
     *
     * При ошибке БД /users отвечает 500 { status: 'error', message }.
     */
    test('Пример 2c: ошибка БД → /users отвечает 500 { status: error }', async () => {
        mockUsersDbBehavior = { mode: 'error', message: 'unable to open database file' };

        const server = await startServer();
        try {
            const port = server.address().port;
            const res = await httpGet(port, '/users');

            expect(res.statusCode).toBe(500);
            expect(JSON.parse(res.body).status).toBe('error');
        } finally {
            await closeServer(server);
        }
    });
});

// ---------------------------------------------------------------------------
// Property 2d: /sync → 200 при успехе, 503 без бота, 500 при ошибке
// ---------------------------------------------------------------------------

describe('Property 2d: /sync — 200 при успехе, 503 без бота, 500 при ошибке', () => {
    /**
     * Validates: Requirements 3.3
     */
    test('Пример 2d: успешный syncSchedule → /sync отвечает 200 { status: ok }', async () => {
        notifications.syncSchedule.mockImplementation(() => Promise.resolve());

        const server = await startServer({}); // непустой bot
        try {
            const port = server.address().port;
            const res = await httpGet(port, '/sync');

            expect(res.statusCode).toBe(200);
            expect(JSON.parse(res.body).status).toBe('ok');
        } finally {
            await closeServer(server);
        }
    });

    /**
     * Validates: Requirements 3.3, 3.4
     *
     * Когда bot отсутствует (null), /sync отвечает 503 до вызова handleSync.
     */
    test('Пример 2d: bot отсутствует → /sync отвечает 503 { status: error }', async () => {
        const server = await startServer(null);
        try {
            const port = server.address().port;
            const res = await httpGet(port, '/sync');

            expect(res.statusCode).toBe(503);
            expect(JSON.parse(res.body).status).toBe('error');
        } finally {
            await closeServer(server);
        }
    });

    /**
     * Validates: Requirements 3.3
     *
     * Ошибка синхронизации → /sync отвечает 500 { status: error }.
     */
    test('Пример 2d: ошибка syncSchedule → /sync отвечает 500 { status: error }', async () => {
        notifications.syncSchedule.mockImplementation(() => Promise.reject(new Error('CRM недоступен')));

        const server = await startServer({});
        try {
            const port = server.address().port;
            const res = await httpGet(port, '/sync');

            expect(res.statusCode).toBe(500);
            expect(JSON.parse(res.body).status).toBe('error');
        } finally {
            await closeServer(server);
        }
    });
});

// ---------------------------------------------------------------------------
// Property 2e: неизвестные пути → 404
// ---------------------------------------------------------------------------

describe('Property 2e: неизвестные пути возвращают 404', () => {
    const KNOWN_PATHS = new Set(['/healthcheck', '/users', '/sync']);

    /**
     * Validates: Requirements 3.4
     */
    test('Пример 2e: "/" и "/unknown" → 404', async () => {
        const server = await startServer({});
        try {
            const port = server.address().port;

            const rootRes = await httpGet(port, '/');
            const unknownRes = await httpGet(port, '/unknown');

            expect(rootRes.statusCode).toBe(404);
            expect(unknownRes.statusCode).toBe(404);
        } finally {
            await closeServer(server);
        }
    });

    /**
     * Validates: Requirements 3.4
     *
     * Property: любой путь, не входящий в набор известных маршрутов, → 404.
     */
    test('Property 2e: любой неизвестный путь → 404', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc
                    .webSegment()
                    .map((seg) => `/${seg}`)
                    .filter((p) => !KNOWN_PATHS.has(p)),
                async (path) => {
                    const server = await startServer({});
                    try {
                        const port = server.address().port;
                        const res = await httpGet(port, path);
                        return res.statusCode === 404;
                    } finally {
                        await closeServer(server);
                    }
                }
            ),
            { numRuns: 20, seed: 42 }
        );
    });
});
