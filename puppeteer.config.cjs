const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
    // يخبر المكتبة بتحميل المتصفح داخل مجلد .cache في مشروعك
    cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};