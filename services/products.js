'use strict';

const axios = require('axios');
const fs = require('fs');
const NodeCache = require('node-cache');
const path = require('path');
const XLSX = require('xlsx');

const SHEET_ID = process.env.PRODUCT_SHEET_ID || '10C954V-_NJU7dCO9M7Ts1pLudCk8F8BrhCXcsRqT12M';
const SHEET_NAME = process.env.PRODUCT_SHEET_NAME || 'Sheet1';

const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
const CACHE_KEY = 'products';
const CACHE_META_KEY = 'products_meta';
const BUNDLED_CACHE_FILE = path.join(__dirname, '..', 'data', 'products-cache.json');
let persistentStore = null;
let productsLoadPromise = null;
let bundledCache = null;

function setPersistentStore(store) {
  persistentStore = store;
}

function getCachedProducts() {
  return cache.get(CACHE_KEY) || null;
}

function setCachedProducts(products, meta = {}) {
  cache.set(CACHE_KEY, products);
  cache.set(CACHE_META_KEY, {
    count: products.length,
    updatedAt: new Date().toISOString(),
    source: meta.source || 'memory',
    ...meta
  });
}

function getCacheMeta() {
  return cache.get(CACHE_META_KEY) || null;
}

function readBundledProducts() {
  if (bundledCache) return bundledCache;
  if (!fs.existsSync(BUNDLED_CACHE_FILE)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(BUNDLED_CACHE_FILE, 'utf8'));
    if (!parsed || !Array.isArray(parsed.products)) return null;
    bundledCache = parsed;
    return bundledCache;
  } catch (err) {
    console.error('[products] Bundled cache read failed:', err.message);
    return null;
  }
}

function extractDriveFileId(url) {
  if (!url) return null;
  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function toDisplayImageUrl(url) {
  if (!url) return null;
  const fileId = extractDriveFileId(url);
  if (fileId) return `/api/products/image/${encodeURIComponent(fileId)}`;
  return url;
}

function toDownloadUrl(url) {
  if (!url) return null;
  const fileId = extractDriveFileId(url);
  if (fileId) return `/api/products/download/${encodeURIComponent(fileId)}`;
  return url;
}

function toVideoEmbedUrl(url) {
  if (!url) return null;
  const fileId = extractDriveFileId(url);
  if (fileId) return `https://drive.google.com/file/d/${fileId}/preview`;
  return url;
}

function extractUrlFromCell(cell) {
  if (!cell) return null;

  if (cell.l && typeof cell.l.Target === 'string' && /^https?:\/\//.test(cell.l.Target)) {
    return cell.l.Target;
  }

  const { v, f } = cell;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (/^https?:\/\//.test(trimmed)) return trimmed;
  }

  if (typeof f === 'string') {
    const urlMatch = f.match(/https?:\/\/[^\s)"']+/);
    if (urlMatch) return urlMatch[0];
  }

  return null;
}

function extractTextFromCell(cell) {
  if (!cell || cell.v == null) return null;
  return String(cell.v).trim() || null;
}

function extractImageFromImageFormula(cell) {
  return extractUrlFromCell(cell);
}

function parseGvizResponse(text) {
  const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\);?\s*$/);
  if (!match) throw new Error('Invalid gviz response');
  return JSON.parse(match[1]).table;
}

const COL = {
  NAME: 0,
  SKU: 1,
  CAT: 2,
  MAIN_IMG: 3,
  MAIN_DL: 4,
  IMG2_ES: 5,
  IMG2_ES_DL: 6,
  IMG2_ZH: 7,
  IMG2_ZH_DL: 8,
  IMG3_ES: 9,
  IMG3_ES_DL: 10,
  IMG3_ZH: 11,
  IMG3_ZH_DL: 12,
  IMG4_ES: 13,
  IMG4_ES_DL: 14,
  IMG4_ZH: 15,
  IMG4_ZH_DL: 16,
  DESC_ES: 17,
  DESC_ZH: 18,
  VIDEO_AD: 19,
  VIDEO_TUT: 20
};

function cellAt(row, idx) {
  return row.c && row.c[idx] ? row.c[idx] : null;
}

function rowToProduct(row) {
  const sku = extractTextFromCell(cellAt(row, COL.SKU));
  if (!sku) return null;
  if (sku.toLowerCase() === 'sku') return null;

  const product = {
    sku,
    name: extractTextFromCell(cellAt(row, COL.NAME)) || '',
    category: extractTextFromCell(cellAt(row, COL.CAT)) || '',
    mainImage: null,
    imageGroups: [],
    videos: [],
    descriptions: {
      es: extractTextFromCell(cellAt(row, COL.DESC_ES)) || '',
      zh: extractTextFromCell(cellAt(row, COL.DESC_ZH)) || ''
    },
    stats: { imageCount: 0, videoCount: 0, docCount: 0 }
  };

  const mainImageUrl = extractImageFromImageFormula(cellAt(row, COL.MAIN_IMG)) || extractUrlFromCell(cellAt(row, COL.MAIN_IMG));
  const mainDownloadUrl = extractUrlFromCell(cellAt(row, COL.MAIN_DL));
  const mainViewUrl = mainImageUrl || mainDownloadUrl;
  if (mainViewUrl) {
    product.mainImage = {
      url: toDisplayImageUrl(mainViewUrl),
      downloadUrl: toDownloadUrl(mainDownloadUrl || mainImageUrl),
      label: '主产品图'
    };
    product.stats.imageCount++;
  }

  const groups = [
    { key: 'image2', title: '产品海报', esCol: COL.IMG2_ES, esDl: COL.IMG2_ES_DL, zhCol: COL.IMG2_ZH, zhDl: COL.IMG2_ZH_DL },
    { key: 'image3', title: '颜色展示图', esCol: COL.IMG3_ES, esDl: COL.IMG3_ES_DL, zhCol: COL.IMG3_ZH, zhDl: COL.IMG3_ZH_DL },
    { key: 'image4', title: '使用场景图', esCol: COL.IMG4_ES, esDl: COL.IMG4_ES_DL, zhCol: COL.IMG4_ZH, zhDl: COL.IMG4_ZH_DL }
  ];

  for (const group of groups) {
    const items = [];
    for (const lang of ['es', 'zh']) {
      const imgCol = lang === 'es' ? group.esCol : group.zhCol;
      const dlCol = lang === 'es' ? group.esDl : group.zhDl;
      const imgUrl = extractImageFromImageFormula(cellAt(row, imgCol)) || extractUrlFromCell(cellAt(row, imgCol));
      const dlUrl = extractUrlFromCell(cellAt(row, dlCol));
      const viewUrl = imgUrl || dlUrl;

      if (viewUrl) {
        items.push({
          lang,
          url: toDisplayImageUrl(viewUrl),
          downloadUrl: toDownloadUrl(dlUrl || imgUrl),
          label: lang === 'es' ? '西语版' : '中文版'
        });
        product.stats.imageCount++;
      }
    }

    if (items.length > 0) {
      product.imageGroups.push({ title: group.title, groupKey: group.key, items });
    }
  }

  const adUrl = extractUrlFromCell(cellAt(row, COL.VIDEO_AD));
  if (adUrl) {
    product.videos.push({
      type: 'ad',
      title: '广告视频',
      url: adUrl,
      embedUrl: toVideoEmbedUrl(adUrl),
      downloadUrl: toDownloadUrl(adUrl)
    });
    product.stats.videoCount++;
  }

  const tutorialUrl = extractUrlFromCell(cellAt(row, COL.VIDEO_TUT));
  if (tutorialUrl) {
    product.videos.push({
      type: 'tutorial',
      title: '使用说明视频',
      url: tutorialUrl,
      embedUrl: toVideoEmbedUrl(tutorialUrl),
      downloadUrl: toDownloadUrl(tutorialUrl)
    });
    product.stats.videoCount++;
  }

  if (product.descriptions.es) product.stats.docCount++;
  if (product.descriptions.zh) product.stats.docCount++;

  return product;
}

async function fetchFromGoogleSheet() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(SHEET_NAME)}`;
  const { data } = await axios.get(url, { timeout: 15000 });
  const table = parseGvizResponse(data);

  const products = [];
  for (const row of table.rows || []) {
    if (!row || !row.c) continue;
    try {
      const product = rowToProduct(row);
      if (product) products.push(product);
    } catch (err) {
      console.error('Skip invalid product row:', err.message);
    }
  }

  return products;
}

function worksheetRowToProduct(worksheet, rowIndex) {
  const row = { c: [] };
  for (let colIndex = 0; colIndex <= COL.VIDEO_TUT; colIndex++) {
    const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
    row.c[colIndex] = worksheet[address] || null;
  }
  return rowToProduct(row);
}

async function fetchFromGoogleSheetXlsx() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx&sheet=${encodeURIComponent(SHEET_NAME)}`;
  const { data } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 90000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    headers: {
      'User-Agent': 'Mozilla/5.0 AccessoryGuide/1.0'
    }
  });
  const workbook = XLSX.read(data, {
    type: 'buffer',
    cellFormula: true,
    cellHTML: true,
    cellStyles: false
  });
  const worksheet = workbook.Sheets[SHEET_NAME] || workbook.Sheets[workbook.SheetNames[0]];
  if (!worksheet || !worksheet['!ref']) return [];

  const range = XLSX.utils.decode_range(worksheet['!ref']);
  const products = [];
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex++) {
    try {
      const product = worksheetRowToProduct(worksheet, rowIndex);
      if (product) products.push(product);
    } catch (err) {
      console.error('Skip invalid xlsx product row:', err.message);
    }
  }
  return products;
}

async function fetchFromGoogleSheetXlsxWithRetry() {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fetchFromGoogleSheetXlsx();
    } catch (err) {
      lastErr = err;
      console.error(`[products] xlsx fetch attempt ${attempt} failed:`, err.message);
    }
  }
  throw lastErr;
}

async function loadProductsFromGoogleSheet() {
  const products = await fetchFromGoogleSheet();
  const hasImageLinks = products.some(product => product.stats.imageCount > 0);
  if (hasImageLinks) {
    console.log(`[products] Loaded ${products.length} products from Google Sheet gviz`);
    return { products, source: 'google-sheet-gviz' };
  }

  try {
    const xlsxProducts = await fetchFromGoogleSheetXlsxWithRetry();
    console.log(`[products] Loaded ${xlsxProducts.length} products from Google Sheet xlsx export`);
    return { products: xlsxProducts, source: 'google-sheet-xlsx' };
  } catch (xlsxErr) {
    console.error('[products] xlsx fallback failed, using gviz data:', xlsxErr.message);
    return { products, source: 'google-sheet-gviz-fallback' };
  }
}

async function readPersistentProducts() {
  if (!persistentStore || !persistentStore.read) return null;
  try {
    const stored = await persistentStore.read();
    if (stored && Array.isArray(stored.products)) {
      setCachedProducts(stored.products, {
        source: stored.source || 'persistent-cache',
        updatedAt: stored.updatedAt || new Date().toISOString()
      });
      return stored.products;
    }
  } catch (err) {
    console.error('[products] Persistent cache read failed:', err.message);
  }
  return null;
}

async function writePersistentProducts(products, source) {
  if (!persistentStore || !persistentStore.write) return;
  try {
    await persistentStore.write({ products, source, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[products] Persistent cache write failed:', err.message);
  }
}

async function syncProductsFromGoogleSheet() {
  const { products, source } = await loadProductsFromGoogleSheet();
  setCachedProducts(products, { source });
  await writePersistentProducts(products, source);
  return products;
}

async function getAllProducts(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = getCachedProducts();
    if (cached) return cached;

    const persistent = await readPersistentProducts();
    if (persistent) return persistent;

    const bundled = readBundledProducts();
    if (bundled) {
      setCachedProducts(bundled.products, {
        source: bundled.source || 'bundled-cache',
        updatedAt: bundled.updatedAt || new Date().toISOString()
      });
      return bundled.products;
    }
  }

  try {
    if (!forceRefresh && productsLoadPromise) return await productsLoadPromise;
    productsLoadPromise = syncProductsFromGoogleSheet();
    return await productsLoadPromise;
  } catch (err) {
    console.error('[products] Fetch failed:', err.message);
    const cached = getCachedProducts();
    if (cached) return cached;

    const persistent = await readPersistentProducts();
    if (persistent) return persistent;

    const bundled = readBundledProducts();
    if (bundled) {
      setCachedProducts(bundled.products, {
        source: bundled.source || 'bundled-cache',
        updatedAt: bundled.updatedAt || new Date().toISOString()
      });
      return bundled.products;
    }

    throw err;
  } finally {
    productsLoadPromise = null;
  }
}

async function getProductBySku(sku) {
  const products = await getAllProducts();
  return products.find(product => product.sku === sku) || null;
}

async function getAllCategories() {
  const products = await getAllProducts();
  const categories = new Set();
  products.forEach(product => {
    if (product.category) categories.add(product.category);
  });
  return Array.from(categories).sort();
}

async function searchProducts({ q, category }) {
  let products = await getAllProducts();

  if (category) {
    products = products.filter(product => product.category === category);
  }

  if (q) {
    const lower = q.toLowerCase();
    products = products.filter(product =>
      product.sku.toLowerCase().includes(lower) ||
      product.name.toLowerCase().includes(lower)
    );
  }

  return products;
}

function clearCache() {
  cache.del(CACHE_KEY);
  cache.del(CACHE_META_KEY);
}

module.exports = {
  setPersistentStore,
  getAllProducts,
  getProductBySku,
  getAllCategories,
  searchProducts,
  clearCache,
  getCacheMeta,
  syncProductsFromGoogleSheet
};
