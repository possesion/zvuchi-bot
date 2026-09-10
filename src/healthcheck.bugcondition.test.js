/**
 * Exploration-тест баг-условия: Property 1 — No Self-Alert on Healthcheck Failure
 *
 * Validates: Requirements 1.1, 1.2, 1.3 / 2.1, 2.2, 2.3
 *
 * CRITICAL: Этот тест ДОЛЖЕН УПАСТЬ на неисправленном коде.
 * Падение подтверждает существование бага (самореферентный алерт + alertSent-состояние).
 * DO NOT fix the code or the test when it fails.
 *
 * Баг: при недоступности api.telegram.org checkTelegramApi() бросает ошибку,
 * а handleHealthcheck() вызывает sendAlert() — который пытается доставить
 * сообщение через тот же недоступный host api.telegram.org — и мутирует
 * модульное состояние alertSent (single-shot). Это добавляет бесполезный
 * лог-шум и связывает поведение со скрытым состоянием.
 *
 * Этот тест кодирует ОЖИДАЕМОЕ (исправленное) поведение:
 *   - при сбое: 503 + { status: 'error', message }, лог "[healthcheck] ОШИБКА: <message>"
 *   - НИКАКИХ исходящих alert-запросов (https.request к api.telegram.org)
 *   - НИКАКИХ alert-логов ("Ошибка ... алерта")
 *   - НИКАКОЙ мутации alertSent: два подряд сбоя ведут себя идентично
 *     (второй не подавляется), а сбой→успех НЕ печатает "Восстановление после сбоя".
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

let logger;
let https;
let requestSpy;

/**
 * Фейковый ClientRequest, чтобы sendAlert() на неисправленном коде не делал
 * реальных сетевых вызовов. Шпион всё равно фиксирует сам факт вызова —
 * именно это разоблачает баг.
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
 * (port || ... || 3000), поэтому нельзя полагаться на автопорт ОС — выдаём
 * возрастающие уникальные порты, чтобы избежать коллизий/TIME_WAIT между тестами.
 */
let nextPort = 34071;

/**
 * Запускает healthcheck-сервер на уникальном порту и ждёт listening.
 */
function startServer() {
    const { startHealthcheckServer } = require('./healthcheck');
    const port = nextPort++;
    const server = startHealthcheckServer(null, port);
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        if (server.listening) return resolve(server);
        server.once('listening', () => resolve(server));
    });
}

function closeServer(server) {
    return new Promise((resolve) => server.close(resolve));
}

/**
 * Возвращает список исходящих alert-запросов (https.request к api.telegram.org).
 */
function alertRequestCalls() {
    return requestSpy.mock.calls.filter((call) => {
        const opts = call[0];
        return opts && opts.hostname === 'api.telegram.org';
    });
}

/**
 * Возвращает alert-связанные строки логов (лог-шум от sendAlert).
 */
function alertLogLines() {
    const all = [...logger.error.mock.calls, ...logger.warn.mock.calls, ...logger.info.mock.calls];
    return all.filter((call) => String(call[0]).toLowerCase().includes('алерт'));
}

beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    logger = require('./logger');
    https = require('node:https');
    requestSpy = jest.spyOn(https, 'request').mockImplementation(() => makeFakeRequest());

    process.env.API_KEY_BOT = 'test-bot-token';
    process.env.ALERT_BOT_TOKEN = 'alert-bot-token';
    process.env.ALERT_CHAT_ID = '123456';
});

afterEach(() => {
    requestSpy.mockRestore();
    delete global.fetch;
});

// ---------------------------------------------------------------------------
// Test 1: единичный сбой — 503 + лог ошибки, БЕЗ alert-запроса и alert-логов
// ---------------------------------------------------------------------------

describe('Test 1: сбой healthcheck НЕ инициирует самореферентный алерт', () => {
    /**
     * Validates: Requirements 2.1, 2.2
     *
     * Ожидаемое (исправленное) поведение: при сбое checkTelegramApi() ответ 503
     * с { status:'error', message }, лог "[healthcheck] ОШИБКА: <message>",
     * и НИ ОДНОГО исходящего alert-запроса и alert-лога.
     *
     * На неисправленном коде sendAlert() вызовет https.request к api.telegram.org
     * → alertRequestCalls().length === 1 → тест падает (баг подтверждён).
     */

    const failureCases = [
        { label: 'DNS failure',  message: 'getaddrinfo EAI_AGAIN api.telegram.org' },
        { label: 'timeout',      message: 'The operation was aborted due to timeout' },
        { label: 'AggregateError', message: 'fetch failed' },
        { label: '502',          message: 'Telegram getMe вернул HTTP 502' },
    ];

    for (const { label, message } of failureCases) {
        test(`Контрпример (${label}): 503 + лог ошибки, без alert-запроса`, async () => {
            global.fetch = jest.fn(() => Promise.reject(new Error(message)));

            const server = await startServer();
            try {
                const port = server.address().port;
                const res = await httpGet(port, '/healthcheck');

                // Ожидаемое поведение (сохраняется после фикса)
                expect(res.statusCode).toBe(503);
                expect(JSON.parse(res.body)).toEqual({ status: 'error', message });
                expect(logger.error).toHaveBeenCalledWith(`[healthcheck] ОШИБКА: ${message}`);

                // Баг-условие: НЕ должно быть alert-запросов и alert-логов
                expect(alertRequestCalls()).toHaveLength(0);
                expect(alertLogLines()).toHaveLength(0);
            } finally {
                await closeServer(server);
            }
        });
    }

    /**
     * Property-based: для ЛЮБОГО непустого сообщения сбоя выполняется инвариант
     * 503 + error-body + error-log, и НЕТ ни одного alert-запроса.
     *
     * Validates: Requirements 2.1, 2.2
     */
    test('Property 1: для любого сообщения сбоя — 503 без alert-запроса', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0),
                async (rawMessage) => {
                    jest.clearAllMocks();
                    requestSpy.mockImplementation(() => makeFakeRequest());
                    global.fetch = jest.fn(() => Promise.reject(new Error(rawMessage)));

                    const server = await startServer();
                    try {
                        const port = server.address().port;
                        const res = await httpGet(port, '/healthcheck');

                        const bodyOk =
                            res.statusCode === 503 &&
                            JSON.parse(res.body).status === 'error';
                        const noAlert = alertRequestCalls().length === 0;

                        return bodyOk && noAlert;
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
// Test 2: два подряд сбоя ведут себя идентично (второй НЕ подавляется)
// ---------------------------------------------------------------------------

describe('Test 2: два подряд сбоя не связаны скрытым alertSent-состоянием', () => {
    /**
     * Validates: Requirements 1.3 / 2.3
     *
     * Ожидаемое (исправленное) поведение: оба сбоя логируют ошибку и отвечают 503
     * идентично, и суммарно НЕТ ни одного alert-запроса.
     *
     * На неисправленном коде первый сбой вызывает sendAlert() (https.request),
     * а второй подавляется из-за alertSent=true → поведение зависит от скрытого
     * состояния → alertRequestCalls().length === 1 → тест падает (баг подтверждён).
     */
    test('Контрпример: оба сбоя идентичны, суммарно 0 alert-запросов', async () => {
        const message = 'getaddrinfo EAI_AGAIN api.telegram.org';
        global.fetch = jest.fn(() => Promise.reject(new Error(message)));

        const server = await startServer();
        try {
            const port = server.address().port;

            const first = await httpGet(port, '/healthcheck');
            const second = await httpGet(port, '/healthcheck');

            // Оба ответа идентичны
            expect(first.statusCode).toBe(503);
            expect(second.statusCode).toBe(503);
            expect(first.body).toBe(second.body);

            // Оба залогировали ошибку
            const errorLogs = logger.error.mock.calls.filter(
                (c) => String(c[0]) === `[healthcheck] ОШИБКА: ${message}`
            );
            expect(errorLogs).toHaveLength(2);

            // Суммарно ни одного alert-запроса (второй не подавляется, т.к. алертов нет)
            expect(alertRequestCalls()).toHaveLength(0);
            expect(alertLogLines()).toHaveLength(0);
        } finally {
            await closeServer(server);
        }
    });
});

// ---------------------------------------------------------------------------
// Test 3: сбой → успех НЕ печатает "Восстановление после сбоя"
// ---------------------------------------------------------------------------

describe('Test 3: восстановление после сбоя не сбрасывает alert-состояние', () => {
    /**
     * Validates: Requirements 2.3 / 3.1
     *
     * Ожидаемое (исправленное) поведение: успех после сбоя отвечает 200
     * { status:'ok' } и логирует "[healthcheck] OK" — БЕЗ строки
     * "Восстановление после сбоя — Alert State сброшен".
     *
     * На неисправленном коде первый сбой ставит alertSent=true, а последующий
     * успех печатает "Восстановление после сбоя ..." → тест падает (баг подтверждён).
     */
    test('Контрпример: успех после сбоя не печатает reset-лог', async () => {
        const failMessage = 'fetch failed';
        let shouldFail = true;
        global.fetch = jest.fn(() => {
            if (shouldFail) return Promise.reject(new Error(failMessage));
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
        });

        const server = await startServer();
        try {
            const port = server.address().port;

            const failRes = await httpGet(port, '/healthcheck');
            expect(failRes.statusCode).toBe(503);

            shouldFail = false;
            const okRes = await httpGet(port, '/healthcheck');

            // Успех обрабатывается штатно
            expect(okRes.statusCode).toBe(200);
            expect(JSON.parse(okRes.body)).toEqual({ status: 'ok' });
            expect(logger.info).toHaveBeenCalledWith('[healthcheck] OK');

            // НЕ должно быть reset-лога восстановления
            const resetLogs = logger.info.mock.calls.filter((c) =>
                String(c[0]).includes('Восстановление после сбоя')
            );
            expect(resetLogs).toHaveLength(0);

            // И ни одного alert-запроса за всю последовательность
            expect(alertRequestCalls()).toHaveLength(0);
        } finally {
            await closeServer(server);
        }
    });
});
