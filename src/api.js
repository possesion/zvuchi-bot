require('dotenv').config();

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
        const res = await fetch(`${hostname}/v2api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: process.env.CRM_EMAIL,
                api_key: process.env.CRM_API_KEY
            })
        });

        const data = await res.json();

        if (data?.token) {
            authToken = data.token;
            tokenExpiry = Date.now() + 3500 * 1000;
            console.log('Получен новый токен');
            return authToken;
        }

        throw new Error('Не удалось получить токен');
    } catch (error) {
        console.error('Ошибка получения токена:', error);
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
            body: JSON.stringify(payload)
        });

        if (response.status === 401) {
            console.log('Получена 401 ошибка, обновляем токен...');
            authToken = null;
            tokenExpiry = null;

            const newToken = await getAuthToken();
            const retryResponse = await fetch(url, {
                method: 'POST',
                headers: {
                    'X-ALFACRM-TOKEN': newToken,
                },
                body: JSON.stringify(payload)
            });

            return await retryResponse.json();
        }

        return await response.json();
    } catch (error) {
        console.error('Ошибка API запроса:', error);
        throw error;
    }
}

async function getClientData(phone, forceRefresh = false) {
    const cacheKey = phone;
    const cached = clientCache.get(cacheKey);

    // Проверяем кэш
    if (!forceRefresh && cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log('Данные клиента из кэша');
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
        console.log('Данные клиента обновлены');
    }

    return clientData;
}

module.exports = {
    getClientData
};
