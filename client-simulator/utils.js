// utils.js — shared helpers

import fs from 'fs';
import path from 'path';
import { createObjectCsvWriter } from 'csv-writer';

export function getLocalTimestamp() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, -1);
}

export function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

/**
 * Ensure directory exists and return a csv-writer instance.
 */
export function makeCsvWriter(filePath, header) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    return createObjectCsvWriter({ path: filePath, header });
}

/**
 * Run a function for each item in `items` with at most `concurrency`
 * promises running at the same time.
 */
export async function pLimit(items, concurrency, fn) {
    const results = [];
    let index = 0;

    async function worker() {
        while (index < items.length) {
            const i = index++;
            results[i] = await fn(items[i], i);
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
    await Promise.all(workers);
    return results;
}
