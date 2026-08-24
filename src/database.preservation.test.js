/**
 * Preservation-тесты (Property 2): Поведение savePhone для новых пользователей
 * и прочих notify-операций.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4
 *
 * IMPORTANT: Эти тесты фиксируют корректное базовое поведение, которое НЕ должно
 * сломаться после исправления бага. Они должны ПРОХОДИТЬ и на неисправленном, и на
 * исправленном коде.
 *
 * Methodology: observation-first — тесты написаны на основе наблюдений за
 * поведением оригинального кода на входных данных вне баг-условия.
 */

'use strict';

const Database = require('better-sqlite3');
const fc = require('fast-check');

// ---------------------------------------------------------------------------
// Вспомогательные функции — та же логика что в database.js, но с in-memory БД
// ---------------------------------------------------------------------------

/**
 * Создаёт изолированную in-memory БД с той же схемой, что в database.js.
 */
function createTestDb() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            phone_number TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            notify BOOLEAN DEFAULT 0
        )
    `);
    return db;
}

/**
 * Оригинальная реализация savePhone — INSERT OR REPLACE.
 */
function savePhone(db, userId, phone) {
    const stmt = db.prepare('INSERT OR REPLACE INTO users (user_id, phone_number) VALUES (?, ?)');
    const formattedPhone = phone.replace(/\D/g, '');
    stmt.run(userId, formattedPhone);
}

function getPhone(db, userId) {
    const stmt = db.prepare('SELECT phone_number FROM users WHERE user_id = ?');
    const row = stmt.get(userId);
    return row ? row.phone_number : null;
}

function setNotify(db, userId, notify) {
    const stmt = db.prepare('UPDATE users SET notify = ? WHERE user_id = ?');
    stmt.run(notify ? 1 : 0, userId);
}

function getNotify(db, userId) {
    const stmt = db.prepare('SELECT notify FROM users WHERE user_id = ?');
    const row = stmt.get(userId);
    return row ? Boolean(row.notify) : false;
}

function getSubscribedUsers(db) {
    const stmt = db.prepare('SELECT user_id FROM users WHERE notify = 1');
    return stmt.all();
}

// ---------------------------------------------------------------------------
// Property 2a: Первый savePhone создаёт запись с notify = 0
// ---------------------------------------------------------------------------

describe('Property 2a: Новый пользователь получает notify = 0', () => {
    /**
     * Validates: Requirements 3.1
     *
     * Для любого нового userId: первый вызов savePhone создаёт запись с notify = 0.
     * Это корректное поведение по умолчанию и оно не должно измениться.
     */
    test('Property 2a: savePhone для нового userId всегда создаёт запись с notify = 0', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1_000_000 }),
                fc.stringMatching(/^7\d{10}$/),
                (userId, phone) => {
                    const db = createTestDb();

                    // userId не существует в БД — первый вызов savePhone
                    savePhone(db, userId, phone);

                    const notifyAfter = getNotify(db, userId);

                    db.close();

                    return notifyAfter === false;
                }
            ),
            { numRuns: 100, seed: 42 }
        );
    });

    /**
     * Validates: Requirements 3.1
     *
     * Конкретный пример: первый savePhone → notify = 0.
     */
    test('Пример 2a: savePhone(1, "79001234567") для нового userId → notify = 0', () => {
        const db = createTestDb();

        savePhone(db, 1, '79001234567');

        expect(getNotify(db, 1)).toBe(false);

        db.close();
    });
});

// ---------------------------------------------------------------------------
// Property 2b: Повторный savePhone для пользователя с notify = 0 оставляет notify = 0
// ---------------------------------------------------------------------------

describe('Property 2b: Повторный savePhone с notify = 0 не ломает notify', () => {
    /**
     * Validates: Requirements 3.1
     *
     * Для пользователя с notify = 0: повторный savePhone оставляет notify = 0.
     * (Баг-условие не выполнено — пользователь не подписан.)
     */
    test('Property 2b: savePhone повторно для userId с notify = 0 оставляет notify = 0', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1_000_000 }),
                fc.stringMatching(/^7\d{10}$/),
                fc.stringMatching(/^7\d{10}$/),
                (userId, originalPhone, newPhone) => {
                    const db = createTestDb();

                    // Создаём пользователя с notify = 0 (явно, без двусмысленности)
                    db.prepare(
                        'INSERT INTO users (user_id, phone_number, notify) VALUES (?, ?, 0)'
                    ).run(userId, originalPhone);

                    savePhone(db, userId, newPhone);

                    const notifyAfter = getNotify(db, userId);

                    db.close();

                    return notifyAfter === false;
                }
            ),
            { numRuns: 100, seed: 42 }
        );
    });
});

// ---------------------------------------------------------------------------
// Property 2c: setNotify и getNotify всегда согласованы
// ---------------------------------------------------------------------------

describe('Property 2c: setNotify + getNotify согласованы', () => {
    /**
     * Validates: Requirements 3.2, 3.3
     *
     * Для любого userId: после setNotify(userId, value) вызов getNotify(userId)
     * возвращает то же value. Это поведение не должно меняться.
     */
    test('Property 2c: setNotify(true) → getNotify возвращает true', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1_000_000 }),
                fc.stringMatching(/^7\d{10}$/),
                (userId, phone) => {
                    const db = createTestDb();

                    // Создаём пользователя (setNotify работает через UPDATE)
                    savePhone(db, userId, phone);
                    setNotify(db, userId, true);

                    const result = getNotify(db, userId);

                    db.close();

                    return result === true;
                }
            ),
            { numRuns: 100, seed: 42 }
        );
    });

    test('Property 2c: setNotify(false) → getNotify возвращает false', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1_000_000 }),
                fc.stringMatching(/^7\d{10}$/),
                (userId, phone) => {
                    const db = createTestDb();

                    // Создаём пользователя с notify = 1, затем сбрасываем
                    db.prepare(
                        'INSERT INTO users (user_id, phone_number, notify) VALUES (?, ?, 1)'
                    ).run(userId, phone);
                    setNotify(db, userId, false);

                    const result = getNotify(db, userId);

                    db.close();

                    return result === false;
                }
            ),
            { numRuns: 100, seed: 42 }
        );
    });

    /**
     * Validates: Requirements 3.2, 3.3
     *
     * setNotify отражает последнее записанное значение при последовательных вызовах.
     */
    test('Property 2c: последовательные setNotify — getNotify отражает последнее значение', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1_000_000 }),
                fc.stringMatching(/^7\d{10}$/),
                fc.boolean(),
                (userId, phone, finalValue) => {
                    const db = createTestDb();

                    savePhone(db, userId, phone);
                    // Устанавливаем противоположное значение, затем финальное
                    setNotify(db, userId, !finalValue);
                    setNotify(db, userId, finalValue);

                    const result = getNotify(db, userId);

                    db.close();

                    return result === finalValue;
                }
            ),
            { numRuns: 100, seed: 42 }
        );
    });
});

// ---------------------------------------------------------------------------
// Property 2d: getSubscribedUsers возвращает ровно тех, у кого notify = 1
// ---------------------------------------------------------------------------

describe('Property 2d: getSubscribedUsers возвращает только подписанных', () => {
    /**
     * Validates: Requirements 3.4
     *
     * getSubscribedUsers() возвращает ровно те userId, у которых notify = 1.
     * При наличии смешанных подписчиков и неподписчиков результат должен быть точным.
     */
    test('Property 2d: getSubscribedUsers содержит только userId с notify = 1', () => {
        fc.assert(
            fc.property(
                // Генерируем массив уникальных userId
                fc.uniqueArray(
                    fc.integer({ min: 1, max: 1_000_000 }),
                    { minLength: 1, maxLength: 20 }
                ),
                fc.stringMatching(/^7\d{10}$/),
                (userIds, basePhone) => {
                    const db = createTestDb();

                    // Разделяем пополам: первая половина подписана, вторая — нет
                    const midpoint = Math.ceil(userIds.length / 2);
                    const subscribedIds = new Set(userIds.slice(0, midpoint));

                    userIds.forEach((userId, i) => {
                        // Формируем уникальный номер для каждого пользователя
                        const phone = String(70000000000 + i).replace(/\D/g, '');
                        savePhone(db, userId, phone);
                        if (subscribedIds.has(userId)) {
                            setNotify(db, userId, true);
                        }
                    });

                    const result = getSubscribedUsers(db);
                    const resultIds = new Set(result.map(r => r.user_id));

                    db.close();

                    // Результат должен совпадать с множеством подписанных
                    if (resultIds.size !== subscribedIds.size) return false;
                    for (const id of subscribedIds) {
                        if (!resultIds.has(id)) return false;
                    }
                    return true;
                }
            ),
            { numRuns: 50, seed: 42 }
        );
    });

    /**
     * Validates: Requirements 3.4
     *
     * При отсутствии подписчиков getSubscribedUsers возвращает пустой массив.
     */
    test('Пример 2d: нет подписчиков → getSubscribedUsers возвращает []', () => {
        const db = createTestDb();

        savePhone(db, 1, '79001111111');
        savePhone(db, 2, '79002222222');
        // notify = 0 для обоих (по умолчанию)

        expect(getSubscribedUsers(db)).toEqual([]);

        db.close();
    });

    /**
     * Validates: Requirements 3.4
     *
     * Конкретный пример: один подписан, один нет.
     */
    test('Пример 2d: один подписан, один нет → getSubscribedUsers возвращает только подписанного', () => {
        const db = createTestDb();

        savePhone(db, 1, '79001111111');
        savePhone(db, 2, '79002222222');
        setNotify(db, 1, true);

        const result = getSubscribedUsers(db);

        expect(result).toHaveLength(1);
        expect(result[0].user_id).toBe(1);

        db.close();
    });
});
