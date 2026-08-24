/**
 * Exploration-тест баг-условия: Property 1 - Сброс notify при повторном savePhone
 *
 * Validates: Requirements 1.1, 1.2
 *
 * CRITICAL: Этот тест ДОЛЖЕН УПАСТЬ на неисправленном коде.
 * Падение подтверждает существование бага.
 * DO NOT fix the code or the test when it fails.
 *
 * Баг: savePhone использует INSERT OR REPLACE, что SQLite реализует как
 * DELETE + INSERT. При этом колонка notify сбрасывается к дефолтному
 * значению 0, даже если пользователь был подписан (notify = 1).
 */

'use strict';

const Database = require('better-sqlite3');
const fc = require('fast-check');

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
 * Оригинальная (неисправленная) реализация savePhone — INSERT OR REPLACE.
 * Именно этот SQL является корнем бага.
 */
function savePhone_original(db, userId, phone) {
    const stmt = db.prepare('INSERT OR REPLACE INTO users (user_id, phone_number) VALUES (?, ?)');
    const formattedPhone = phone.replace(/\D/g, '');
    stmt.run(userId, formattedPhone);
}

/**
 * Исправленная реализация savePhone — INSERT ... ON CONFLICT DO UPDATE.
 * Обновляет только phone_number, не затрагивая notify и created_at.
 */
function savePhone_fixed(db, userId, phone) {
    const stmt = db.prepare(
        'INSERT INTO users (user_id, phone_number) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET phone_number = excluded.phone_number'
    );
    const formattedPhone = phone.replace(/\D/g, '');
    stmt.run(userId, formattedPhone);
}

function getNotify(db, userId) {
    const stmt = db.prepare('SELECT notify FROM users WHERE user_id = ?');
    const row = stmt.get(userId);
    return row ? Boolean(row.notify) : false;
}

// ---------------------------------------------------------------------------
// Property 1: Bug Condition — savePhone сбрасывает notify=1 в 0
// ---------------------------------------------------------------------------

describe('Property 1: Bug Condition — сброс notify при повторном savePhone', () => {
    /**
     * Validates: Requirements 1.1, 1.2
     *
     * Для любого существующего пользователя с notify=1:
     * после вызова savePhone(userId, newPhone) значение getNotify(userId)
     * ДОЛЖНО остаться true (1).
     *
     * На неисправленном коде этот тест УПАДЁТ — notify становится 0.
     */
    test('Property 1: savePhone не должен сбрасывать notify=1 для существующего пользователя', () => {
        fc.assert(
            fc.property(
                // userId — произвольное целое число
                fc.integer({ min: 1, max: 1_000_000 }),
                // originalPhone — первоначальный номер
                fc.stringMatching(/^7\d{10}$/),
                // newPhone — новый номер (может совпадать или отличаться)
                fc.stringMatching(/^7\d{10}$/),
                (userId, originalPhone, newPhone) => {
                    const db = createTestDb();

                    // Создаём пользователя с notify = 1 (isBugCondition = true)
                    db.prepare(
                        'INSERT INTO users (user_id, phone_number, notify) VALUES (?, ?, 1)'
                    ).run(userId, originalPhone);

                    // Вызываем оригинальный savePhone — баг должен проявиться
                    savePhone_original(db, userId, newPhone);

                    // Ожидаем true, но оригинальный код вернёт false
                    const notifyAfter = getNotify(db, userId);

                    db.close();

                    return notifyAfter === true;
                }
            ),
            { numRuns: 100, seed: 42 }
        );
    });

    /**
     * Конкретный детерминированный пример бага (документация контрпримера).
     * savePhone(1, '79001234567') после notify=1 → notify стал 0
     *
     * Validates: Requirements 1.1, 1.2
     */
    test('Контрпример: savePhone(1, "79001234567") после notify=1 → notify должен остаться 1', () => {
        const db = createTestDb();

        // Пользователь с notify = 1
        db.prepare(
            'INSERT INTO users (user_id, phone_number, notify) VALUES (?, ?, 1)'
        ).run(1, '79000000000');

        // Повторный savePhone с тем же userId
        savePhone_original(db, 1, '79001234567');

        const notifyAfter = getNotify(db, 1);

        db.close();

        // Ожидаем true — на неисправленном коде будет false (баг подтверждён)
        expect(notifyAfter).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Property 1: Fix Verification — savePhone_fixed сохраняет notify=1
// ---------------------------------------------------------------------------

describe('Property 1: Fix Verification — notify сохраняется после savePhone_fixed', () => {
    /**
     * Validates: Requirements 2.1, 2.2
     *
     * Для любого существующего пользователя с notify=1:
     * после вызова savePhone_fixed(userId, newPhone) значение getNotify(userId)
     * ДОЛЖНО остаться true (1).
     *
     * Этот тест ДОЛЖЕН ПРОЙТИ — подтверждает что исправление работает.
     */
    test('Property 1 Fix: savePhone_fixed не сбрасывает notify=1 для существующего пользователя', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1_000_000 }),
                fc.stringMatching(/^7\d{10}$/),
                fc.stringMatching(/^7\d{10}$/),
                (userId, originalPhone, newPhone) => {
                    const db = createTestDb();

                    // Создаём пользователя с notify = 1
                    db.prepare(
                        'INSERT INTO users (user_id, phone_number, notify) VALUES (?, ?, 1)'
                    ).run(userId, originalPhone);

                    // Вызываем исправленный savePhone
                    savePhone_fixed(db, userId, newPhone);

                    const notifyAfter = getNotify(db, userId);

                    db.close();

                    return notifyAfter === true;
                }
            ),
            { numRuns: 100, seed: 42 }
        );
    });

    /**
     * Конкретный детерминированный пример исправления.
     * savePhone_fixed(1, '79001234567') после notify=1 → notify остался 1
     *
     * Validates: Requirements 2.1, 2.2
     */
    test('Контрпример Fix: savePhone_fixed(1, "79001234567") после notify=1 → notify остался 1', () => {
        const db = createTestDb();

        db.prepare(
            'INSERT INTO users (user_id, phone_number, notify) VALUES (?, ?, 1)'
        ).run(1, '79000000000');

        savePhone_fixed(db, 1, '79001234567');

        const notifyAfter = getNotify(db, 1);

        db.close();

        expect(notifyAfter).toBe(true);
    });
});
