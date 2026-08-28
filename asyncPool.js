/**
 * Robuster asyncPool mit striktem Timeout und AbortController
 */
'use strict';

async function asyncPool(poolLimit, array, iteratorFn, timeoutMs = 10000) {
    const ret = [];
    const executing = [];

    for (const item of array) {
        const p = Promise.resolve().then(async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            try {
                return await iteratorFn(item, { signal: controller.signal });
            } catch (error) {
                if (error.name === 'AbortError' || error.message.includes('aborted') || error.message.includes('Aborted')) {
                    console.warn(`[ASYNC-POOL] Task timed out after ${timeoutMs}ms, überspringe blockierten Request.`);
                    return null; 
                }
                throw error;
            } finally {
                clearTimeout(timeoutId);
            }
        });

        ret.push(p);

        if (poolLimit <= array.length) {
            const e = p.then(() => executing.splice(executing.indexOf(e), 1));
            executing.push(e);
            if (executing.length >= poolLimit) {
                await Promise.race(executing);
            }
        }
    }
    return Promise.all(ret);
}

module.exports = asyncPool;
