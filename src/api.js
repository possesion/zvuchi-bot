require('dotenv').config();

const logger = require('./logger');

const hostname = 'https://zvuchi.s20.online';

let authToken = null;
let tokenExpiry = null;

// Кэш данных клиентов: { phone: { data, timestamp } }
const clientCache = new Map();
const CACHE_TTL = 60 * 1000; // 1 минута

async function getAuthToken() {
    if (authToken && tokenExpiry && Date.now() < tokenExpiry) {
        return authToken;
    }

    try {
        logger.info('Попытка получить токен от CRM', { hostname });
        const res = await fetch(`${hostname}/v2api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: process.env.CRM_EMAIL,
                api_key: process.env.CRM_API_KEY
            }),
            timeout: 10000
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const data = await res.json();

        if (data?.token) {
            authToken = data.token;
            tokenExpiry = Date.now() + 3500 * 1000;
            logger.info('Получен новый токен от CRM');
            return authToken;
        }

        throw new Error('Не удалось получить токен: ' + JSON.stringify(data));
    } catch (error) {
        logger.error('Ошибка получения токена от CRM', { error, hostname });
        throw error;
    }
}

async function apiRequest(url, payload) {
    try {
        const token = await getAuthToken();

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'X-ALFACRM-TOKEN': token,
            },
            body: JSON.stringify(payload),
            timeout: 10000
        });

        if (response.status === 401) {
            logger.info('Получена 401 ошибка от CRM, обновляем токен');
            authToken = null;
            tokenExpiry = null;

            const newToken = await getAuthToken();
            const retryResponse = await fetch(url, {
                method: 'POST',
                headers: {
                    'X-ALFACRM-TOKEN': newToken,
                },
                body: JSON.stringify(payload),
                timeout: 10000
            });

            if (!retryResponse.ok) {
                throw new Error(`HTTP ${retryResponse.status} при повторном запросе`);
            }

            return await retryResponse.json();
        }

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        logger.error('Ошибка API запроса', { error });
        throw error;
    }
}

async function getClientData(phone, forceRefresh = false) {
    const cacheKey = phone;
    const cached = clientCache.get(cacheKey);

    // Проверяем кэш
    if (!forceRefresh && cached && Date.now() - cached.timestamp < CACHE_TTL) {
        logger.info('Данные клиента из кэша', { phone });
        return cached.data;
    }

    // Запрашиваем свежие данные
    const payload = {
        is_study: 1,
        phone: [phone],
        page: 0,
    };

    const result = await apiRequest(`${hostname}/v2api/1/customer/index`, payload);
    const clientData = result.items?.[0];

    if (clientData) {
        clientCache.set(cacheKey, {
            data: clientData,
            timestamp: Date.now()
        });
        logger.info('Данные клиента обновлены', { phone });
    }

    return clientData;
}

module.exports = {
    getClientData
};
