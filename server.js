'use strict';
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const axios = require('axios');
const XLSX = require('xlsx');
const multer = require('multer');
let Pool;
let createClient;
try { Pool = require('pg').Pool; } catch { console.warn('⚠️ pg not available'); }
try { createClient = require('@supabase/supabase-js').createClient; } catch { console.warn('⚠️ @supabase/supabase-js not available'); }

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_SETTINGS = { siteName: 'TEMCO ACCESORIOS', version: 'v1.0' };
let pool;
let bundledDBCache;
let dbConnectPromise = null;

// PostgreSQL connection. SUPABASE_URL is the HTTPS API URL, not a database URL.
const PG_CONNECTION_STRING = process.env.DATABASE_URL
  || process.env.POSTGRES_URL
  || process.env.POSTGRES_PRISMA_URL
  || process.env.SUPABASE_DB_URL;

async function connectDB() {
  if (pool) return pool;
  if (dbConnectPromise) return dbConnectPromise;
  if (!PG_CONNECTION_STRING || !Pool) {
    if (!Pool) console.warn('⚠️  pg module not available');
    else console.warn('⚠️  No DATABASE_URL set, using bundled data only');
    return null;
  }
  if (!/^postgres(ql)?:\/\//.test(PG_CONNECTION_STRING)) {
    console.error('DATABASE_URL must be a PostgreSQL connection string, not SUPABASE_URL');
    return null;
  }
  dbConnectPromise = (async () => {
    pool = new Pool({
      connectionString: PG_CONNECTION_STRING,
      ssl: PG_CONNECTION_STRING.includes('supabase') ? { rejectUnauthorized: false } : false,
    });
    try {
      await pool.query('SELECT 1');
      console.log('✅ Connected to PostgreSQL');
      await migrateSchema();
      return pool;
    } catch (err) {
      console.error('❌ PostgreSQL connection error:', err.message);
      await pool.end().catch(() => {});
      pool = null;
      dbConnectPromise = null;
      return null;
    }
  })();
  return dbConnectPromise;
}

async function migrateSchema() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_data (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS products (
        sku TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        synced_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS products_meta (
        id TEXT PRIMARY KEY DEFAULT 'syncMeta',
        count INTEGER DEFAULT 0,
        source TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        sku TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        synced_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products_meta (
        id TEXT PRIMARY KEY DEFAULT 'syncMeta',
        count INTEGER DEFAULT 0,
        source TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('✅ Schema migrated');
  } catch (err) {
    console.error('[migrate] Schema error:', err.message);
  }
}

async function ensureProductSchema() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_data (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      sku TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products_meta (
      id TEXT PRIMARY KEY DEFAULT 'syncMeta',
      count INTEGER DEFAULT 0,
      source TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function readDB() {
  if (!pool) return getDefaultDBData();
  try {
    const { rows } = await pool.query('SELECT value FROM app_data WHERE key = $1', ['main']);
    if (rows.length > 0) return rows[0].value;
  } catch (err) {
    console.error('[readDB] Error:', err.message);
  }
  return getDefaultDBData();
}

async function writeDB(data) {
  if (!pool) return;
  try {
    await pool.query(
      'INSERT INTO app_data (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
      ['main', JSON.stringify(data)]
    );
  } catch (err) {
    console.error('[writeDB] Error:', err.message);
  }
}

// Multer config for logo upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'public'));
  },
  filename: (req, file, cb) => {
    cb(null, 'Logo.png');
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });
const uploadMemory = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const JWT_SECRET = process.env.JWT_SECRET || 'accessory-guide-secret-2024';
const XLSX_FILE = path.join(__dirname, 'data.xlsx');

// Ensure data dir exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

// --- PostgreSQL Connection (Supabase) ---
let httpServer;

async function connectDB() {
  if (pool) return pool;
  const PG_CONNECTION_STRING = process.env.DATABASE_URL || process.env.SUPABASE_URL;
  if (!PG_CONNECTION_STRING) {
    console.warn('⚠️  No DATABASE_URL set, using bundled data only');
    return null;
  }
  pool = new Pool({
    connectionString: PG_CONNECTION_STRING,
    ssl: PG_CONNECTION_STRING.includes('supabase') ? { rejectUnauthorized: false } : false,
  });
  try {
    await pool.query('SELECT 1');
    console.log('✅ Connected to PostgreSQL (Supabase)');
    await migrateSchema();
    return pool;
  } catch (err) {
    console.error('❌ PostgreSQL connection error:', err.message);
    pool = null;
    return null;
  }
}

async function migrateSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_data (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✅ Schema migrated');
  } catch (err) {
    console.error('[migrate] Schema error:', err.message);
  }
}

async function readDB() {
  if (!pool) return getDefaultDBData();
  try {
    const { rows } = await pool.query('SELECT value FROM app_data WHERE key = $1', ['main']);
    if (rows.length > 0) return rows[0].value;
  } catch (err) {
    console.error('[readDB] Error:', err.message);
  }
  return getDefaultDBData();
}

async function writeDB(data) {
  if (!pool) return;
  try {
    await pool.query(
      'INSERT INTO app_data (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
      ['main', JSON.stringify(data)]
    );
  } catch (err) {
    console.error('[writeDB] Error:', err.message);
  }
}

async function readPublicDB() {
  return await readDB();
}

function getDefaultDBData() {
  return {
    ipad: [],
    watch: [],
    film: { fullGlue: {}, twoPointFiveD: [], privacy: [] },
    settings: DEFAULT_SETTINGS,
    translations: {},
    filmSearchStats: [],
    siteVisits: { total: 0, byDate: {}, pages: {}, referrers: {} }
  };
}

function readBundledDBData() {
  if (bundledDBCache) return bundledDBCache;
  const bundledPath = path.join(__dirname, 'data', 'db.json');
  if (!fs.existsSync(bundledPath)) {
    bundledDBCache = getDefaultDBData();
    return bundledDBCache;
  }
  bundledDBCache = { ...getDefaultDBData(), ...JSON.parse(fs.readFileSync(bundledPath, 'utf8')) };
  return bundledDBCache;
}

// --- Default translations ---
const DEFAULT_TRANSLATIONS = {
  zh: {
    nav_film: '钢化膜通用',
    nav_ipad: 'iPad',
    nav_watch: 'Watch',
    title_film: '钢化膜通用型号查询',
    title_ipad: 'iPad 配件兼容性',
    title_watch: 'Apple Watch 配件兼容性',
    subtitle_film: '全胶钢化膜通用型号兼容性对照',
    subtitle_ipad: '查询各代 iPad 的保护壳和钢化膜通用情况',
    subtitle_watch: '查询各代 Apple Watch 的保护壳和表带通用情况',
    title_amazon: '亚马逊爆款精选',
    subtitle_amazon: '一站式选品参考',
    tagline_amazon: '精选好物，帮你做出明智选择',
    amazon_updated: '数据更新:',
    amazon_update_schedule: '每周五更新数据',
    amazon_login_tip: '登录后可查看完整100条',
    amazon_show_20: '20条',
    amazon_show_100: '100条',
    btn_load_more: '加载更多',
    mode_bestseller: '🔥 热销',
    mode_mostwanted: '❤️ 最想拥有',
    items: '个',
    amazon_filter_type: '榜单:',
    amazon_filter_cat: '品类:',
    search_film: '搜索型号，如 A71、POCO X3、Reno5...',
    search_ipad: '搜索 iPad 型号...',
    search_watch: '搜索 Watch 型号...',
    brand_filter: '品牌',
    brand_all: '全部',
    collapse: '收起',
    film_count: '个膜型号',
    ipad_count: '款',
    device_case: '保护壳',
    device_film: '钢化膜',
    device_caseband: '保护壳 / 表带',
    watch_film: '钢化膜',
    compatible: '通用',
    not_compatible: '不通用',
    special_warning: '⚠',
    admin_title: '后台管理',
    admin_dashboard: '数据概览',
    admin_traffic_stats: '流量统计',
    admin_ipad_mgmt: 'iPad 管理',
    admin_watch_mgmt: 'Watch 管理',
    admin_film_mgmt: '膜数据管理',
    admin_users_mgmt: '用户管理',
    admin_settings_mgmt: '系统设置',
    admin_logout: '退出',
    admin_view_front: '查看前台',
    quick_actions: '快速操作',
    stat_ipad: 'iPad 型号',
    stat_watch: 'Watch 型号',
    stat_film: '全胶防静电膜',
    stat_2d: '2.5D 膜条目',
    stat_privacy: '防窥膜',
    stat_users: '管理用户',
    stat_total_visits: '总访问量',
    stat_today_visits: '今日访问量',
    stat_film_search: '膜搜索统计',
    film_search_stats: '热门搜索型号',
    search_keywords_stats: '热门搜索关键字',
    traffic_7d: '近 7 天',
    traffic_30d: '近 30 天',
    traffic_daily_trend: '每日访问趋势',
    traffic_top_pages: '热门页面',
    traffic_referrers: '访问来源',
    film_search_count: '搜索次数',
    film_search_last: '最后搜索',
    quick_actions: '快速操作',
    btn_add_ipad: '+ 新增型号',
    btn_add_watch: '+ 新增型号',
    btn_add_film: '+ 新增膜组',
    btn_add_user: '+ 新增用户',
    th_name: '型号名称',
    th_series: '系列',
    th_gen: '代次',
    th_action: '操作',
    th_film_model: '膜型号',
    th_brands: '品牌数',
    th_models: '型号数',
    th_username: '用户名',
    th_role: '角色',
    th_created: '创建时间',
    btn_edit: '编辑',
    btn_delete: '删除',
    btn_save: '保存',
    btn_cancel: '取消',
    system_account: '系统账户',
    modal_add: '新增',
    modal_edit: '编辑',
    modal_add_ipad: '新增 iPad 型号',
    modal_add_watch: '新增 Watch 型号',
    modal_add_film: '新增膜组',
    modal_add_user: '新增用户',
    confirm_delete: '确认删除？',
    confirm_delete_film: '确认删除该膜组？',
    deleted: '已删除',
    film_deleted: '膜组已删除',
    role_editor: '编辑',
    login_title: 'TEMCO ACCESORIOS',
    login_admin: '后台管理',
    login_username: '用户名',
    login_password: '密码',
    login_btn: '登录',
    login_error: '用户名或密码错误',
    login_tab: '登录',
    login_email: '邮箱',
    register_tab: '注册',
    register_name: '姓名',
    register_btn: '注册',
    login_register: '登录 / 注册',
    register_phone: '电话',
    register_store: '商店名称 / 公司名称',
    password_placeholder: '至少6位',
    fill_required: '请填写必填项',
    member_center: '会员中心',
    logout: '退出',
    save_changes: '保存修改',
    change_password: '修改密码',
    old_password: '旧密码',
    new_password: '新密码',
    current_password: '当前密码',
    confirm_new_password: '确认新密码',
    confirm_new_password_placeholder: '再次输入新密码',
    update_password: '更新密码',
    enter_old_password: '请填写旧密码',
    enter_new_password: '请填写新密码',
    password_min_6: '新密码至少6位',
    passwords_do_not_match: '两次输入的新密码不一致',
    old_password_incorrect: '旧密码不正确',
    password_update_failed: '修改失败',
    password_updated: '密码已修改',
    network_error: '网络错误',
    save_success: '保存成功',
    avatar_updated: '头像已更新',
    nav_film_parent: '钢化膜',
    nav_film_child: '通用型号查询',
    nav_ipad_child: 'iPad',
    nav_watch_child: 'Apple Watch',
    nav_sourcing: '选品助手',
    nav_amazon_child: 'Amazon',
    nav_google_child: 'Google',
    nav_calculator: '商业计算器',
    nav_products: '产品素材库',
    nav_google: 'Google',
    google_title: 'Google 全品类热销周报',
    google_subtitle: '西班牙市场 • Google Merchant Center 数据源',
    google_no_data: '暂无数据',
    google_sync_hint: '请先在管理后台同步 Google 数据',
    google_not_found: '未找到',
    google_rank: '排名',
    google_brand: '品牌',
    google_product: '产品',
    google_trend: '热度',
    google_total: '共 {count} 条',
    google_data_from: '数据来源: Google Merchant Center',
    admin_products_mgmt: '产品素材管理',
    admin_sync_title: '数据同步',
    admin_sync_products: '同步产品素材',
    admin_sync_amazon: '同步 Amazon 数据',
    admin_sync_google: '同步 Google 数据',
    admin_sync_all: '同步全部数据',
    empty_ipad: '未找到匹配的 iPad 型号',
    empty_watch: '暂无 Watch 数据，请在后台添加',
    empty_film: '未找到匹配结果',
    loaded_count: '已加载',
    // iPad info cards
    ipad_film_title: '钢化膜财富密码',
    ipad_film_super: '超级通用组：iPad 10/11、Air 4/5、Air 11 (M2/M4)、Pro 11旧款 — 钢化膜尺寸几乎完全一致',
    ipad_film_13inch: '13寸新规：Pro 13 / Air 13 (2024+) — 屏幕面板相同，膜通用',
    ipad_case_title: '保护壳避坑指南',
    ipad_case_camera: '横向摄像头：2024+ Air系列前置摄像头移到长边中央，老款Air 4/5壳会遮挡或导致磁吸翻盖无法休眠',
    ipad_case_thickness: '厚度陷阱：M4/M5芯片Pro系列比老款薄1mm+，老款保护壳套上会非常松',
    // Watch info cards
    watch_band_title: '表带两极化通用',
    watch_band_small: '【小码表带组】38mm、40mm、41mm、42mm (S10/11) 全部通用',
    watch_band_small_note: '注：S10/11 的 42mm 连接位仍属"小"规格',
    watch_band_large: '【大码表带组】42mm (S1-3)、44mm、45mm、46mm、49mm (Ultra) 全部通用',
    watch_case_title: '膜/壳精细化注意',
    watch_case_46mm: '46mm (S10/11)：全新薄型设计+广角OLED，必须专用，不兼容旧款45mm',
    watch_case_45_41: '45mm ↔ 41mm：S7/S8/S9 表壳轮廓一致，壳膜完全通用',
    watch_case_44_40: '44mm ↔ 40mm：S4/S5/S6/SE1/SE2/SE3 尺寸基本一致，壳膜通用',
    watch_case_ultra: 'Ultra (49mm)：纯平蓝宝石镜面，与所有弧面屏完全不通用',
    watch_new_title: '2025-2026 新款变动',
    watch_new_se3: 'SE 3 (2025)：保持 40/44mm 经典设计，消化旧款 S6 模具，配件极其好买',
    watch_new_s11: 'Series 11：延续 S10"大屏薄身"设计（42/46mm），与 S10 划为同一配件组',
    // Filter labels
    filter_shape: '外形',
    filter_all: '全部',
    loading_data: '正在加载...',
    filter_fullscreen: '全面屏 (无Home键)',
    filter_homebutton: '有Home键',
    filter_band_group: '表带组',
    filter_small_band: '小码 (38-42mm)',
    filter_large_band: '大码 (44-49mm)',
    filter_screen: '屏幕',
    filter_flat: '纯平 (Ultra)',
    filter_curved: '弧面 (Series)',
    filter_classic: '经典 (早期款)',
    settings_logo: '当前 Logo',
    settings_logo_upload: '上传新 Logo',
    settings_logo_hint: '支持 PNG、JPG，建议尺寸 200x200',
    settings_current_favicon: '当前 favicon',
    settings_upload_favicon: '上传新 favicon',
    settings_favicon_hint: '支持 ICO、PNG、SVG，建议 32x32 或 64x64',
    settings_site_name: '站点名称',
    settings_version: '版本号',
    settings_note: '备注说明',
    settings_save: '保存设置',
    settings_current_logo: '当前 Logo',
    settings_upload_logo: '上传新 Logo',
    settings_logo_hint: '支持 PNG、JPG，建议尺寸 200x200',
    tab_translations: '多语言管理',
    trans_key: 'Key',
    trans_zh: '中文',
    trans_en: 'English',
    trans_es: 'Español',
    trans_save: '保存',
    admin_amazon_cat_title: 'Amazon 品类翻译',
    admin_amazon_cat_desc: '管理 Amazon 榜单品类的多语言显示名称',
    btn_save_cat_trans: '保存品类翻译',
    form_name: '型号名称',
    form_group: '所属系列',
    form_years: '代次标注',
    form_order: '排序序号',
    form_case_comp: '保护壳兼容性',
    form_film_comp: '钢化膜兼容性',
    form_note: '备注说明',
    form_show_warning: '显示警告标识',
    form_film_name: '膜型号名称',
    form_brand: '品牌',
    form_models_list: '通用型号列表 (用 / 分隔)',
    form_username: '用户名',
    form_password: '密码',
    form_role: '角色',
    role_admin: '管理员',
    placeholder_name_ipad: '如: Pro 11 (2021)',
    placeholder_group_ipad: '如: 11 英寸 iPad Pro',
    placeholder_years: '如: Pro 3代',
    placeholder_case_comp: '如: 通用',
    placeholder_film_comp: '如: 通用 (全面屏)',
    placeholder_note: '如: 注意镜头孔位差异',
    placeholder_film_name: '如: SAM A12, RM NOTE9S',
    placeholder_models_list: 'A12/A13/A14/A15...',
    placeholder_username: 'username',
    placeholder_password: '至少6位'
  },
  en: {
    nav_film: 'Tempered Glass',
    nav_ipad: 'iPad',
    nav_watch: 'Watch',
    title_film: 'Tempered Glass Universal Search',
    title_ipad: 'iPad Accessory Compatibility',
    title_watch: 'Apple Watch Accessory Compatibility',
    subtitle_film: 'Full-Glue Tempered Glass Compatibility Guide',
    subtitle_ipad: 'Check case and film compatibility for iPad models',
    subtitle_watch: 'Check case and band compatibility for Apple Watch models',
    title_amazon: 'Amazon Bestsellers Curated',
    subtitle_amazon: 'Your One-Stop Sourcing Guide',
    tagline_amazon: 'Handpicked picks to help you shop smarter',
    amazon_updated: 'Data updated:',
    amazon_update_schedule: 'Updated every Friday',
    amazon_login_tip: 'Login to view all 100 items',
    amazon_show_20: '20 items',
    amazon_show_100: '100 items',
    btn_load_more: 'Load More',
    mode_bestseller: '🔥 Bestseller',
    mode_mostwanted: '❤️ Most Wanted',
    items: 'items',
    amazon_filter_type: 'Type:',
    amazon_filter_cat: 'Category:',
    search_film: 'Search model, e.g. A71, POCO X3, Reno5...',
    search_ipad: 'Search iPad model...',
    search_watch: 'Search Watch model...',
    brand_filter: 'Brand',
    brand_all: 'All',
    collapse: 'Collapse',
    film_count: 'films',
    ipad_count: 'models',
    device_case: 'Case',
    device_film: 'Film',
    device_caseband: 'Case / Band',
    watch_film: 'Film',
    compatible: 'Universal',
    not_compatible: 'Not Universal',
    special_warning: '⚠',
    admin_title: 'Admin Panel',
    admin_dashboard: 'Dashboard',
    admin_traffic_stats: 'Traffic Stats',
    admin_ipad_mgmt: 'iPad Management',
    admin_watch_mgmt: 'Watch Management',
    admin_film_mgmt: 'Film Management',
    admin_users_mgmt: 'User Management',
    admin_settings_mgmt: 'System Settings',
    admin_logout: 'Logout',
    admin_view_front: 'View Site',
    quick_actions: 'Quick Actions',
    stat_ipad: 'iPad Models',
    stat_watch: 'Watch Models',
    stat_film: 'Full-Glue Film',
    stat_2d: '2.5D Films',
    stat_privacy: 'Privacy Films',
    stat_users: 'Users',
    stat_total_visits: 'Total Visits',
    stat_today_visits: 'Today Visits',
    stat_film_search: 'Film Search Stats',
    film_search_stats: 'Popular Searches',
    search_keywords_stats: 'Popular Search Keywords',
    traffic_7d: 'Last 7 Days',
    traffic_30d: 'Last 30 Days',
    traffic_daily_trend: 'Daily Visits',
    traffic_top_pages: 'Top Pages',
    traffic_referrers: 'Referrers',
    film_search_count: 'Searches',
    film_search_last: 'Last Searched',
    quick_actions: 'Quick Actions',
    btn_add_ipad: '+ Add iPad',
    btn_add_watch: '+ Add Watch',
    btn_add_film: '+ Add Film',
    btn_add_user: '+ Add User',
    th_name: 'Name',
    th_series: 'Series',
    th_gen: 'Generation',
    th_action: 'Action',
    th_film_model: 'Film Model',
    th_brands: 'Brands',
    th_models: 'Models',
    th_username: 'Username',
    th_role: 'Role',
    th_created: 'Created',
    btn_edit: 'Edit',
    btn_delete: 'Delete',
    btn_save: 'Save',
    btn_cancel: 'Cancel',
    system_account: 'System Account',
    modal_add: 'Add',
    modal_edit: 'Edit',
    modal_add_ipad: 'Add iPad Model',
    modal_add_watch: 'Add Watch Model',
    modal_add_film: 'Add Film Group',
    modal_add_user: 'Add User',
    confirm_delete: 'Confirm delete?',
    confirm_delete_film: 'Confirm delete this film group?',
    deleted: 'Deleted',
    film_deleted: 'Film group deleted',
    role_editor: 'Editor',
    login_title: 'TEMCO ACCESORIOS',
    login_admin: 'Admin',
    login_username: 'Username',
    login_password: 'Password',
    login_btn: 'Login',
    login_error: 'Invalid username or password',
    login_tab: 'Sign In',
    login_email: 'Email',
    register_tab: 'Register',
    register_name: 'Name',
    register_btn: 'Register',
    login_register: 'Login / Register',
    register_phone: 'Phone',
    register_store: 'Store / Company Name',
    password_placeholder: 'At least 6 characters',
    fill_required: 'Please fill in required fields',
    member_center: 'Member Center',
    logout: 'Sign Out',
    save_changes: 'Save Changes',
    change_password: 'Change Password',
    old_password: 'Old Password',
    new_password: 'New Password',
    current_password: 'Current Password',
    confirm_new_password: 'Confirm New Password',
    confirm_new_password_placeholder: 'Enter the new password again',
    update_password: 'Update Password',
    enter_old_password: 'Please enter your old password',
    enter_new_password: 'Please enter a new password',
    password_min_6: 'New password must be at least 6 characters',
    passwords_do_not_match: 'The two new passwords do not match',
    old_password_incorrect: 'Old password is incorrect',
    password_update_failed: 'Password update failed',
    password_updated: 'Password updated',
    network_error: 'Network error',
    save_success: 'Saved successfully',
    avatar_updated: 'Avatar updated',
    nav_film_parent: 'Tempered Glass',
    nav_film_child: 'Universal Search',
    nav_ipad_child: 'iPad',
    nav_watch_child: 'Apple Watch',
    nav_sourcing: 'Sourcing',
    nav_amazon_child: 'Amazon',
    nav_google_child: 'Google',
    nav_calculator: 'Business Calculator',
    nav_products: 'Product Assets',
    nav_google: 'Google',
    google_title: 'Google Weekly Hot Products',
    google_subtitle: 'Spain Market • Google Merchant Center',
    google_no_data: 'No data',
    google_sync_hint: 'Sync Google data from admin panel first',
    google_not_found: 'Not found',
    google_rank: 'Rank',
    google_brand: 'Brand',
    google_product: 'Product',
    google_trend: 'Trend',
    google_total: '{count} items',
    google_data_from: 'Data source: Google Merchant Center',
    admin_products_mgmt: 'Product Assets',
    admin_sync_title: 'Data Sync',
    admin_sync_products: 'Sync Products',
    admin_sync_amazon: 'Sync Amazon Data',
    admin_sync_google: 'Sync Google Data',
    admin_sync_all: 'Sync All Data',
    empty_ipad: 'No matching iPad models found',
    empty_watch: 'No Watch data. Please add in admin panel.',
    empty_film: 'No matching results',
    loaded_count: 'Loaded',
    // iPad info cards
    ipad_film_title: 'Film Universal Secret',
    ipad_film_super: 'Super Universal Group: iPad 10/11, Air 4/5, Air 11 (M2/M4), Pro 11 old - film sizes almost identical',
    ipad_film_13inch: '13-inch New Rule: Pro 13 / Air 13 (2024+) - same screen panel, film universal',
    ipad_case_title: 'Case Pitfall Guide',
    ipad_case_camera: 'Landscape Camera: 2024+ Air front camera moved to center of long side, old Air 4/5 cases will block camera or cause magnetic flip cover sleep issues',
    ipad_case_thickness: 'Thickness Trap: M4/M5 chip Pro series 1mm+ thinner than old models, old cases will be loose',
    // Watch info cards
    watch_band_title: 'Band Polarized Universal',
    watch_band_small: '【Small Band Group】38mm, 40mm, 41mm, 42mm (S10/11) all universal',
    watch_band_small_note: 'Note: S10/11 42mm connector still belongs to "small" spec',
    watch_band_large: '【Large Band Group】42mm (S1-3), 44mm, 45mm, 46mm, 49mm (Ultra) all universal',
    watch_case_title: 'Film/Case Refinement Note',
    watch_case_46mm: '46mm (S10/11): New slim design + wide-angle OLED, must be dedicated, not compatible with old 45mm',
    watch_case_45_41: '45mm ↔ 41mm: S7/S8/S9 case contour identical, film/case fully universal',
    watch_case_44_40: '44mm ↔ 40mm: S4/S5/S6/SE1/SE2/SE3 size basically identical, film/case universal',
    watch_case_ultra: 'Ultra (49mm): Flat sapphire screen, not universal with any curved screen Series',
    watch_new_title: '2025-2026 New Model Changes',
    watch_new_se3: 'SE 3 (2025): Maintains 40/44mm classic design, mainly to use up old S6 appearance mold, accessories very easy to buy',
    watch_new_s11: 'Series 11: Continues S10 "large screen slim body" design (42/46mm), classified as same accessory group as S10',
    // Filter labels
    filter_shape: 'Shape',
    filter_all: 'All',
    loading_data: 'Loading...',
    filter_fullscreen: 'Full Screen (No Home)',
    filter_homebutton: 'Has Home Button',
    filter_band_group: 'Band Group',
    filter_small_band: 'Small (38-42mm)',
    filter_large_band: 'Large (44-49mm)',
    filter_screen: 'Screen',
    filter_flat: 'Flat (Ultra)',
    filter_curved: 'Curved (Series)',
    filter_classic: 'Classic (Old)',
    settings_logo: 'Current Logo',
    settings_logo_upload: 'Upload New Logo',
    settings_logo_hint: 'PNG, JPG supported. Recommended 200x200',
    settings_current_favicon: 'Current favicon',
    settings_upload_favicon: 'Upload New favicon',
    settings_favicon_hint: 'ICO, PNG, SVG supported. Recommended 32x32 or 64x64',
    settings_site_name: 'Site Name',
    settings_version: 'Version',
    settings_note: 'Notes',
    settings_save: 'Save Settings',
    settings_current_logo: 'Current Logo',
    settings_upload_logo: 'Upload New Logo',
    settings_logo_hint: 'PNG, JPG supported. Recommended 200x200',
    tab_translations: 'Translations',
    trans_key: 'Key',
    trans_zh: 'Chinese',
    trans_en: 'English',
    trans_es: 'Español',
    trans_save: 'Save',
    admin_amazon_cat_title: 'Amazon Category Translation',
    admin_amazon_cat_desc: 'Manage Amazon bestseller category names in multiple languages',
    btn_save_cat_trans: 'Save Category Translations',
    form_name: 'Model Name',
    form_group: 'Series',
    form_years: 'Generation',
    form_order: 'Sort Order',
    form_case_comp: 'Case Compatibility',
    form_film_comp: 'Film Compatibility',
    form_note: 'Notes',
    form_show_warning: 'Show Warning',
    form_film_name: 'Film Model Name',
    form_brand: 'Brand',
    form_models_list: 'Compatible Models (separated by /)',
    form_username: 'Username',
    form_password: 'Password',
    form_role: 'Role',
    role_admin: 'Admin',
    placeholder_name_ipad: 'e.g. Pro 11 (2021)',
    placeholder_group_ipad: 'e.g. 11-inch iPad Pro',
    placeholder_years: 'e.g. Pro 3rd Gen',
    placeholder_case_comp: 'e.g. Universal',
    placeholder_film_comp: 'e.g. Universal (full-screen)',
    placeholder_note: 'e.g. Watch for camera cutout differences',
    placeholder_film_name: 'e.g. SAM A12, RM NOTE9S',
    placeholder_models_list: 'A12/A13/A14/A15...',
    placeholder_username: 'username',
    placeholder_password: 'At least 6 characters'
  },
  es: {
    nav_film: 'Cristal Templado',
    nav_ipad: 'iPad',
    nav_watch: 'Watch',
    title_film: 'Búsqueda Universal de Cristal Templado',
    title_ipad: 'Compatibilidad de Accesorios iPad',
    title_watch: 'Compatibilidad de Accesorios Apple Watch',
    subtitle_film: 'Guía de Compatibilidad de Cristal Adhesivo Completo',
    subtitle_ipad: 'Consultar compatibilidad de fundas y cristales para iPad',
    subtitle_watch: 'Consultar compatibilidad de fundas y correas para Apple Watch',
    title_amazon: 'Los más vendidos en Amazon',
    subtitle_amazon: 'guía completa para tu selección',
    tagline_amazon: 'Selección curada para ayudarte a comprar mejor',
    amazon_updated: 'Datos actualizados:',
    amazon_update_schedule: 'Actualizado cada viernes',
    amazon_login_tip: 'Inicia sesión para ver los 100 artículos',
    amazon_show_20: '20 artículos',
    amazon_show_100: '100 artículos',
    btn_load_more: 'Cargar Más',
    mode_bestseller: '🔥 Más Vendidos',
    mode_mostwanted: '❤️ Más Deseados',
    items: 'artículos',
    amazon_filter_type: 'Tipo:',
    amazon_filter_cat: 'Categoría:',
    search_film: 'Buscar modelo, ej. A71, POCO X3, Reno5...',
    search_ipad: 'Buscar modelo iPad...',
    search_watch: 'Buscar modelo Watch...',
    brand_filter: 'Marca',
    brand_all: 'Todos',
    collapse: 'Contraer',
    film_count: 'cristales',
    ipad_count: 'modelos',
    device_case: 'Funda',
    device_film: 'Cristal',
    device_caseband: 'Funda / Correa',
    watch_film: 'Cristal',
    compatible: 'Universal',
    not_compatible: 'No Universal',
    special_warning: '⚠',
    admin_title: 'Panel de Administración',
    admin_dashboard: 'Panel',
    admin_traffic_stats: 'Estadísticas de Tráfico',
    admin_ipad_mgmt: 'Gestión iPad',
    admin_watch_mgmt: 'Gestión Watch',
    admin_film_mgmt: 'Gestión de Cristales',
    admin_users_mgmt: 'Gestión de Usuarios',
    admin_settings_mgmt: 'Configuración',
    admin_logout: 'Salir',
    admin_view_front: 'Ver Sitio',
    quick_actions: 'Acciones Rápidas',
    stat_ipad: 'Modelos iPad',
    stat_watch: 'Modelos Watch',
    stat_film: 'Cristal Adhesivo',
    stat_2d: 'Cristales 2.5D',
    stat_privacy: 'Cristales Privacidad',
    stat_users: 'Usuarios',
    stat_total_visits: 'Visitas Totales',
    stat_today_visits: 'Visitas de Hoy',
    stat_film_search: 'Búsquedas de Cristales',
    film_search_stats: 'Búsquedas Populares',
    search_keywords_stats: 'Palabras Clave Populares',
    traffic_7d: 'Últimos 7 días',
    traffic_30d: 'Últimos 30 días',
    traffic_daily_trend: 'Visitas Diarias',
    traffic_top_pages: 'Páginas Populares',
    traffic_referrers: 'Referencias',
    film_search_count: 'Búsquedas',
    film_search_last: 'Última Búsqueda',
    quick_actions: 'Acciones Rápidas',
    btn_add_ipad: '+ Agregar iPad',
    btn_add_watch: '+ Agregar Watch',
    btn_add_film: '+ Agregar Cristal',
    btn_add_user: '+ Agregar Usuario',
    th_name: 'Nombre',
    th_series: 'Serie',
    th_gen: 'Generación',
    th_action: 'Acción',
    th_film_model: 'Modelo Cristal',
    th_brands: 'Marcas',
    th_models: 'Modelos',
    th_username: 'Usuario',
    th_role: 'Rol',
    th_created: 'Creado',
    btn_edit: 'Editar',
    btn_delete: 'Eliminar',
    btn_save: 'Guardar',
    btn_cancel: 'Cancelar',
    system_account: 'Cuenta del Sistema',
    modal_add: 'Agregar',
    modal_edit: 'Editar',
    modal_add_ipad: 'Agregar Modelo iPad',
    modal_add_watch: 'Agregar Modelo Watch',
    modal_add_film: 'Agregar Grupo de Cristales',
    modal_add_user: 'Agregar Usuario',
    confirm_delete: '¿Confirmar eliminación?',
    confirm_delete_film: '¿Confirmar eliminar este grupo de cristales?',
    deleted: 'Eliminado',
    film_deleted: 'Grupo de cristales eliminado',
    role_editor: 'Editor',
    login_title: 'TEMCO ACCESORIOS',
    login_admin: 'Administración',
    login_username: 'Usuario',
    login_password: 'Contraseña',
    login_btn: 'Entrar',
    login_error: 'Usuario o contraseña incorrectos',
    login_tab: 'Iniciar sesión',
    login_email: 'Correo electrónico',
    register_tab: 'Registrarse',
    register_name: 'Nombre',
    register_btn: 'Registrarse',
    login_register: 'Iniciar sesión / Registrarse',
    register_phone: 'Teléfono',
    register_store: 'Nombre de tienda / empresa',
    password_placeholder: 'Al menos 6 caracteres',
    fill_required: 'Complete los campos obligatorios',
    member_center: 'Centro de miembros',
    logout: 'Cerrar sesión',
    save_changes: 'Guardar cambios',
    change_password: 'Cambiar contraseña',
    old_password: 'Contraseña anterior',
    new_password: 'Nueva contraseña',
    current_password: 'Contraseña actual',
    confirm_new_password: 'Confirmar nueva contraseña',
    confirm_new_password_placeholder: 'Introduce la nueva contraseña otra vez',
    update_password: 'Actualizar contraseña',
    enter_old_password: 'Introduce la contraseña anterior',
    enter_new_password: 'Introduce una nueva contraseña',
    password_min_6: 'La nueva contraseña debe tener al menos 6 caracteres',
    passwords_do_not_match: 'Las dos contraseñas nuevas no coinciden',
    old_password_incorrect: 'La contraseña anterior no es correcta',
    password_update_failed: 'No se pudo actualizar la contraseña',
    password_updated: 'Contraseña actualizada',
    network_error: 'Error de red',
    save_success: 'Guardado correctamente',
    avatar_updated: 'Avatar actualizado',
    nav_film_parent: 'Cristal Templado',
    nav_film_child: 'Búsqueda Universal',
    nav_ipad_child: 'iPad',
    nav_watch_child: 'Apple Watch',
    nav_sourcing: 'Selección',
    nav_amazon_child: 'Amazon',
    nav_google_child: 'Google',
    nav_calculator: 'Calculadora',
    nav_products: 'Biblioteca de materiales',
    nav_google: 'Google',
    google_title: 'Google Productos Semanales',
    google_subtitle: 'Mercado España • Google Merchant Center',
    google_no_data: 'Sin datos',
    google_sync_hint: 'Sincronice los datos de Google desde el panel de administración',
    google_not_found: 'No encontrado',
    google_rank: 'Ranking',
    google_brand: 'Marca',
    google_product: 'Producto',
    google_trend: 'Tendencia',
    google_total: '{count} artículos',
    google_data_from: 'Fuente: Google Merchant Center',
    admin_products_mgmt: 'Biblioteca de materiales',
    admin_sync_title: 'Sincronización',
    admin_sync_products: 'Sincronizar materiales',
    admin_sync_amazon: 'Sincronizar Amazon',
    admin_sync_google: 'Sincronizar Google',
    admin_sync_all: 'Sincronizar todo',
    empty_ipad: 'No se encontraron modelos de iPad',
    empty_watch: 'Sin datos de Watch. Agregue en el panel.',
    empty_film: 'Sin resultados',
    loaded_count: 'Cargado',
    // iPad info cards
    ipad_film_title: 'Secreto Universal del Cristal',
    ipad_film_super: 'Grupo Universal Súper: iPad 10/11, Air 4/5, Air 11 (M2/M4), Pro 11 antiguo - tamaños de cristal casi idénticos',
    ipad_film_13inch: 'Regla 13 pulgadas: Pro 13 / Air 13 (2024+) - mismo panel de pantalla, cristal universal',
    ipad_case_title: 'Guía de Trampas de Fundas',
    ipad_case_camera: 'Cámara Horizontal: Air 2024+ cámara frontal movida al centro del lado largo, fundas Air 4/5 antiguas bloquean cámara',
    ipad_case_thickness: 'Trampa de Grosor: Serie Pro con chip M4/M5 1mm+ más delgada que modelos antiguos, fundas antiguas flojas',
    // Watch info cards
    watch_band_title: 'Banda Polarizada Universal',
    watch_band_small: '【Grupo Banda Pequeña】38mm, 40mm, 41mm, 42mm (S10/11) todos universales',
    watch_band_small_note: 'Nota: Conector 42mm de S10/11 sigue siendo "pequeño"',
    watch_band_large: '【Grupo Banda Grande】42mm (S1-3), 44mm, 45mm, 46mm, 49mm (Ultra) todos universales',
    watch_case_title: 'Nota de Refinamiento Cristal/Funda',
    watch_case_46mm: '46mm (S10/11): Nuevo diseño delgado + OLED gran angular, debe ser dedicado, no compatible con 45mm antiguo',
    watch_case_45_41: '45mm ↔ 41mm: Contorno de funda S7/S8/S9 idéntico, cristal/funda completamente universal',
    watch_case_44_40: '44mm ↔ 40mm: Tamaño S4/S5/S6/SE1/SE2/SE3 básicamente idéntico, cristal/funda universal',
    watch_case_ultra: 'Ultra (49mm): Pantalla plana de zafiro, no universal con ninguna Serie de pantalla curva',
    watch_new_title: 'Cambios de Modelos Nuevos 2025-2026',
    watch_new_se3: 'SE 3 (2025): Mantiene diseño clásico 40/44mm, principalmente para usar molde antiguo S6, accesorios muy fáciles de comprar',
    watch_new_s11: 'Series 11: Continúa diseño "pantalla grande cuerpo delgado" de S10 (42/46mm), clasificado en mismo grupo de accesorios que S10',
    // Filter labels
    filter_shape: 'Forma',
    filter_all: 'Todos',
    loading_data: 'Cargando...',
    filter_fullscreen: 'Pantalla Completa (Sin Home)',
    filter_homebutton: 'Con Botón Home',
    filter_band_group: 'Grupo de Banda',
    filter_small_band: 'Pequeña (38-42mm)',
    filter_large_band: 'Grande (44-49mm)',
    filter_screen: 'Pantalla',
    filter_flat: 'Plana (Ultra)',
    filter_curved: 'Curva (Series)',
    filter_classic: 'Clásica (Antigua)',
    settings_logo: 'Logo Actual',
    settings_logo_upload: 'Subir Nuevo Logo',
    settings_logo_hint: 'PNG, JPG soportados. Recomendado 200x200',
    settings_current_favicon: 'favicon actual',
    settings_upload_favicon: 'Subir nuevo favicon',
    settings_favicon_hint: 'ICO, PNG, SVG soportados. Recomendado 32x32 o 64x64',
    settings_site_name: 'Nombre del Sitio',
    settings_version: 'Versión',
    settings_note: 'Notas',
    settings_save: 'Guardar',
    settings_current_logo: 'Logo Actual',
    settings_upload_logo: 'Subir Nuevo Logo',
    tab_translations: 'Traducciones',
    trans_key: 'Clave',
    trans_zh: 'Chino',
    trans_en: 'Inglés',
    trans_es: 'Español',
    trans_save: 'Guardar',
    admin_amazon_cat_title: 'Traducción de Categorías Amazon',
    admin_amazon_cat_desc: 'Gestionar nombres de categorías de bestseller Amazon en múltiples idiomas',
    btn_save_cat_trans: 'Guardar Traducciones',
    form_name: 'Nombre del Modelo',
    form_group: 'Serie',
    form_years: 'Generación',
    form_order: 'Orden',
    form_case_comp: 'Compatibilidad de Funda',
    form_film_comp: 'Compatibilidad de Cristal',
    form_note: 'Notas',
    form_show_warning: 'Mostrar Advertencia',
    form_film_name: 'Nombre del Modelo de Cristal',
    form_brand: 'Marca',
    form_models_list: 'Modelos Compatibles (separados por /)',
    form_username: 'Usuario',
    form_password: 'Contraseña',
    form_role: 'Rol',
    role_admin: 'Administrador',
    placeholder_name_ipad: 'ej. Pro 11 (2021)',
    placeholder_group_ipad: 'ej. iPad Pro de 11 pulgadas',
    placeholder_years: 'ej. Pro 3ra Gen',
    placeholder_case_comp: 'ej. Universal',
    placeholder_film_comp: 'ej. Universal (pantalla completa)',
    placeholder_note: 'ej. Cuidado con el recorte de la cámara',
    placeholder_film_name: 'ej. SAM A12, RM NOTE9S',
    placeholder_models_list: 'A12/A13/A14/A15...',
    placeholder_username: 'usuario',
    placeholder_password: 'Al menos 6 caracteres'
  }
};

// --- Content Translation for iPad/Watch data ---
const CONTENT_TRANSLATIONS = {
  // Chinese terms mapped to {en, es}
  '通用': { en: 'Universal', es: 'Universal' },
  '不通用': { en: 'Not Universal', es: 'No Universal' },
  '不适用': { en: 'N/A', es: 'No Aplicable' },
  '专用': { en: 'Dedicated', es: 'Dedicado' },
  '保护壳': { en: 'Case', es: 'Funda' },
  '钢化膜': { en: 'Tempered Glass', es: 'Cristal Templado' },
  '有Home键': { en: 'with Home Button', es: 'con Botón Home' },
  '全面屏': { en: 'Full Screen', es: 'Pantalla Completa' },
  '无Home键': { en: 'No Home Button', es: 'Sin Botón Home' },
  '注意镜头孔位': { en: 'Note camera cutout', es: 'Cuidado con recorte de cámara' },
  '厚度微增': { en: 'Slightly thicker', es: 'Ligeramente más grueso' },
  '部分硬壳可能过紧': { en: 'Some hard cases may be tight', es: 'Algunas fundas rígidas pueden quedar ajustadas' },
  'TouchID 位于顶部': { en: 'TouchID on top', es: 'TouchID en la parte superior' },
  '保护壳顶部开孔': { en: 'Case top opening', es: 'Apertura superior de la funda' },
  '孔位不同': { en: 'Different cutout positions', es: 'Posiciones de corte diferentes' },
  '更薄': { en: 'Thinner', es: 'Más delgado' },
  '有Home键': { en: 'Has Home Button', es: 'Con Botón Home' },
  '全新外观设计': { en: 'All-new design', es: 'Diseño completamente nuevo' },
  '与之前款式不通用': { en: 'Not compatible with previous models', es: 'No compatible con modelos anteriores' },
  '全面屏设计': { en: 'Full-screen design', es: 'Diseño de pantalla completa' },
  '代': { en: 'Gen', es: 'Gen' },
  '代次': { en: 'Generation', es: 'Generación' },
  '系列': { en: 'Series', es: 'Serie' },
  '英寸': { en: 'inch', es: 'pulgadas' },
  'iPad Pro': { en: 'iPad Pro', es: 'iPad Pro' },
  'iPad Air': { en: 'iPad Air', es: 'iPad Air' },
  'iPad mini': { en: 'iPad mini', es: 'iPad mini' },
  'iPad 标准款': { en: 'iPad Standard', es: 'iPad Estándar' },
};

function translateContent(text, lang) {
  if (!text) return text;
  let result = text;
  // Sort keys by length (longest first) to avoid partial replacements
  const keys = Object.keys(CONTENT_TRANSLATIONS).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (result.includes(key)) {
      const replacement = CONTENT_TRANSLATIONS[key][lang] || CONTENT_TRANSLATIONS[key].en || key;
      result = result.split(key).join(replacement);
    }
  }
  return result;
}

function translateItem(item, lang) {
  if (!item) return item;
  const translated = { ...item };
  // Translate main fields
  ['name', 'group', 'years', 'caseComp', 'filmComp', 'note'].forEach(field => {
    if (translated[field] && typeof translated[field] === 'string') {
      translated[field] = translateContent(translated[field], lang);
    }
  });
  return translated;
}

// --- Film data from xlsx ---
function readFilmFromXlsx() {
  if (!fs.existsSync(XLSX_FILE)) return {};
  try {
    const workbook = XLSX.readFile(XLSX_FILE);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    // Format: [膜型号, 兼容机型列表（含 [品牌] 分组）]
    const filmData = {};
    for (let i = 2; i < data.length; i++) { // Skip title and header rows
      const row = data[i];
      if (!row || row.length < 2) continue;
      const filmName = String(row[0] || '').trim();
      const compatString = String(row[1] || '').trim();
      if (!filmName || !compatString) continue;
      
      // Parse [BRAND] sections and models
      const brandRegex = /\[([^\]]+)\]/g;
      const parts = compatString.split(brandRegex);
      // parts: [before first [, brand1, models1, brand2, models2, ...]
      
      for (let j = 1; j < parts.length; j += 2) {
        const brand = parts[j]?.trim();
        const models = parts[j + 1]?.trim().replace(/\n/g, ' ').replace(/\s+/g, ' ') || '';
        if (!brand || !models) continue;
        
        if (!filmData[filmName]) filmData[filmName] = [];
        filmData[filmName].push({ brand, models });
      }
    }
    return filmData;
  } catch (e) {
    console.error('Error reading xlsx:', e);
    return {};
  }
}
// Initialize DB from film_data.json if empty
async function initDB() {
  const db = await readDB();
  const bundled = readBundledDBData();
  let seededFromBundle = false;

  if ((!db.ipad || db.ipad.length === 0) && bundled.ipad && bundled.ipad.length > 0) {
    db.ipad = bundled.ipad;
    seededFromBundle = true;
  }
  if ((!db.watch || db.watch.length === 0) && bundled.watch && bundled.watch.length > 0) {
    db.watch = bundled.watch;
    seededFromBundle = true;
  }
  if (seededFromBundle) {
    await writeDB(db);
    console.log('Seeded iPad/Watch data from bundled data into database');
  }

  const filmSrc = path.join(__dirname, '..', 'film_data.json');
  if ((!db.film || !db.film.fullGlue || Object.keys(db.film.fullGlue).length === 0) && fs.existsSync(filmSrc)) {
    const raw = JSON.parse(fs.readFileSync(filmSrc, 'utf8'));
    db.film = raw;
    await writeDB(db);
    console.log('Initialized film data from film_data.json');
  }
  // Default iPad data - migrate to multi-language if needed
  if (!db.ipad || db.ipad.length === 0) {
    db.ipad = getDefaultiPadData();
    await writeDB(db);
    console.log('Initialized iPad data with multi-language support');
  } else {
    // Migrate existing iPad data to multi-language format
    let needsMigration = false;
    db.ipad = db.ipad.map(item => {
      if (typeof item.name === 'string') {
        needsMigration = true;
        return migrateToMultiLang(item);
      }
      return item;
    });
    if (needsMigration) {
      await writeDB(db);
      console.log('Migrated iPad data to multi-language format');
    }
  }
  // Logto handles user management - skip legacy user creation
}

function getDefaultiPadData() {
  return [
    { 
      id: 1, 
      group: { zh: 'iPad Pro 13"', en: 'iPad Pro 13"', es: 'iPad Pro 13"' }, 
      name: { zh: 'Pro 13 (M4 2024 / M5 2025)', en: 'Pro 13 (M4 2024 / M5 2025)', es: 'Pro 13 (M4 2024 / M5 2025)' }, 
      years: { zh: 'M4/M5', en: 'M4/M5', es: 'M4/M5' }, 
      caseComp: { zh: '专用 (超薄机身/磁吸更新)', en: 'Dedicated (Ultra-thin body/magnetic update)', es: 'Dedicado (Cuerpo ultrafino/actualización magnética)' }, 
      filmComp: { zh: '13寸组 A', en: '13-inch Group A', es: 'Grupo A 13 pulgadas' }, 
      note: { zh: '全面屏/Face ID/无Home键', en: 'Full screen/Face ID/No Home button', es: 'Pantalla completa/Face ID/Sin botón Home' }, 
      specialWarning: true, order: 1 
    },
    { 
      id: 2, 
      group: { zh: 'iPad Air 13"', en: 'iPad Air 13"', es: 'iPad Air 13"' }, 
      name: { zh: 'Air 13 (M2 2024 / M4 2026)', en: 'Air 13 (M2 2024 / M4 2026)', es: 'Air 13 (M2 2024 / M4 2026)' }, 
      years: { zh: 'M2/M4', en: 'M2/M4', es: 'M2/M4' }, 
      caseComp: { zh: '专用 (横向镜头/机身较厚)', en: 'Dedicated (Landscape camera/thicker body)', es: 'Dedicado (Cámara horizontal/cuerpo más grueso)' }, 
      filmComp: { zh: '13寸组 A', en: '13-inch Group A', es: 'Grupo A 13 pulgadas' }, 
      note: { zh: '全面屏/横向摄像头', en: 'Full screen/Landscape camera', es: 'Pantalla completa/Cámara horizontal' }, 
      specialWarning: true, order: 2 
    },
    { 
      id: 3, 
      group: { zh: 'iPad Pro 12.9"', en: 'iPad Pro 12.9"', es: 'iPad Pro 12.9"' }, 
      name: { zh: 'Pro 12.9 (2018/20/21/22)', en: 'Pro 12.9 (2018/20/21/22)', es: 'Pro 12.9 (2018/20/21/22)' }, 
      years: { zh: '3/4/5/6代', en: '3rd/4th/5th/6th Gen', es: 'Gen 3/4/5/6' }, 
      caseComp: { zh: '通用 (3-6代孔位微差)', en: 'Universal (Gen 3-6 slight cutout differences)', es: 'Universal (Gen 3-6 diferencias menores)' }, 
      filmComp: { zh: '12.9寸全屏组', en: '12.9-inch Full Screen Group', es: 'Grupo Pantalla Completa 12.9' }, 
      note: { zh: '全面屏/Face ID', en: 'Full screen/Face ID', es: 'Pantalla completa/Face ID' }, 
      specialWarning: true, order: 3 
    },
    { 
      id: 4, 
      group: { zh: 'iPad Pro 12.9"', en: 'iPad Pro 12.9"', es: 'iPad Pro 12.9"' }, 
      name: { zh: 'Pro 12.9 (2015/2017)', en: 'Pro 12.9 (2015/2017)', es: 'Pro 12.9 (2015/2017)' }, 
      years: { zh: '1/2代', en: '1st/2nd Gen', es: 'Gen 1/2' }, 
      caseComp: { zh: '通用 (1-2代通用)', en: 'Universal (Gen 1-2 universal)', es: 'Universal (Gen 1-2 universal)' }, 
      filmComp: { zh: '12.9寸Home键组', en: '12.9-inch Home Button Group', es: 'Grupo Botón Home 12.9' }, 
      note: { zh: '有Home键/大边框', en: 'With Home button/Large bezels', es: 'Con botón Home/Bordes grandes' }, 
      specialWarning: false, order: 4 
    },
    { 
      id: 5, 
      group: { zh: 'iPad Pro 11"', en: 'iPad Pro 11"', es: 'iPad Pro 11"' }, 
      name: { zh: 'Pro 11 (M4 2024 / M5 2025)', en: 'Pro 11 (M4 2024 / M5 2025)', es: 'Pro 11 (M4 2024 / M5 2025)' }, 
      years: { zh: 'M4/M5', en: 'M4/M5', es: 'M4/M5' }, 
      caseComp: { zh: '专用 (叠层OLED/极薄)', en: 'Dedicated (Stacked OLED/Ultra-thin)', es: 'Dedicado (OLED apilado/Ultradelgado)' }, 
      filmComp: { zh: '11寸M4专用组', en: '11-inch M4 Dedicated Group', es: 'Grupo M4 Dedicado 11 pulgadas' }, 
      note: { zh: '全面屏/Face ID', en: 'Full screen/Face ID', es: 'Pantalla completa/Face ID' }, 
      specialWarning: true, order: 5 
    },
    { 
      id: 6, 
      group: { zh: 'iPad Pro 11"', en: 'iPad Pro 11"', es: 'iPad Pro 11"' }, 
      name: { zh: 'Pro 11 (2018/20/21/22)', en: 'Pro 11 (2018/20/21/22)', es: 'Pro 11 (2018/20/21/22)' }, 
      years: { zh: '1/2/3/4代', en: '1st/2nd/3rd/4th Gen', es: 'Gen 1/2/3/4' }, 
      caseComp: { zh: '通用 (1-4代通用)', en: 'Universal (Gen 1-4 universal)', es: 'Universal (Gen 1-4 universal)' }, 
      filmComp: { zh: '11寸/10.9寸通用组', en: '11-inch/10.9-inch Universal Group', es: 'Grupo Universal 11/10.9 pulgadas' }, 
      note: { zh: '全面屏/Face ID', en: 'Full screen/Face ID', es: 'Pantalla completa/Face ID' }, 
      specialWarning: true, order: 6 
    },
    { 
      id: 7, 
      group: { zh: 'iPad Air 11"', en: 'iPad Air 11"', es: 'iPad Air 11"' }, 
      name: { zh: 'Air 11 (M2 2024 / M4 2026)', en: 'Air 11 (M2 2024 / M4 2026)', es: 'Air 11 (M2 2024 / M4 2026)' }, 
      years: { zh: 'M2/M4', en: 'M2/M4', es: 'M2/M4' }, 
      caseComp: { zh: '专用 (横向摄像头)', en: 'Dedicated (Landscape camera)', es: 'Dedicado (Cámara horizontal)' }, 
      filmComp: { zh: '11寸/10.9寸通用组', en: '11-inch/10.9-inch Universal Group', es: 'Grupo Universal 11/10.9 pulgadas' }, 
      note: { zh: '全面屏/横向摄像头', en: 'Full screen/Landscape camera', es: 'Pantalla completa/Cámara horizontal' }, 
      specialWarning: true, order: 7 
    },
    { 
      id: 8, 
      group: { zh: 'iPad Air 4/5', en: 'iPad Air 4/5', es: 'iPad Air 4/5' }, 
      name: { zh: 'Air 4 (2020) / Air 5 (2022)', en: 'Air 4 (2020) / Air 5 (2022)', es: 'Air 4 (2020) / Air 5 (2022)' }, 
      years: { zh: '4/5代', en: '4th/5th Gen', es: 'Gen 4/5' }, 
      caseComp: { zh: '通用 (Air 4/5通用)', en: 'Universal (Air 4/5 universal)', es: 'Universal (Air 4/5 universal)' }, 
      filmComp: { zh: '11寸/10.9寸通用组', en: '11-inch/10.9-inch Universal Group', es: 'Grupo Universal 11/10.9 pulgadas' }, 
      note: { zh: '全面屏/侧边指纹', en: 'Full screen/Side fingerprint', es: 'Pantalla completa/Lector de huellas lateral' }, 
      specialWarning: false, order: 8 
    },
    { 
      id: 9, 
      group: { zh: 'iPad 标准版', en: 'iPad Standard', es: 'iPad Estándar' }, 
      name: { zh: 'iPad 10 (2022) / iPad 11 (2025)', en: 'iPad 10 (2022) / iPad 11 (2025)', es: 'iPad 10 (2022) / iPad 11 (2025)' }, 
      years: { zh: '10/11代', en: '10th/11th Gen', es: 'Gen 10/11' }, 
      caseComp: { zh: '通用 (10/11代通用)', en: 'Universal (10/11 Gen universal)', es: 'Universal (Gen 10/11 universal)' }, 
      filmComp: { zh: '11寸/10.9寸通用组', en: '11-inch/10.9-inch Universal Group', es: 'Grupo Universal 11/10.9 pulgadas' }, 
      note: { zh: '全面屏/直角边设计', en: 'Full screen/Square edge design', es: 'Pantalla completa/Diseño de bordes rectos' }, 
      specialWarning: false, order: 9 
    },
    { 
      id: 10, 
      group: { zh: 'iPad 标准版', en: 'iPad Standard', es: 'iPad Estándar' }, 
      name: { zh: 'iPad 7 / 8 / 9 (2019-2021)', en: 'iPad 7 / 8 / 9 (2019-2021)', es: 'iPad 7 / 8 / 9 (2019-2021)' }, 
      years: { zh: '7/8/9代', en: '7th/8th/9th Gen', es: 'Gen 7/8/9' }, 
      caseComp: { zh: '通用 (7/8/9代通用)', en: 'Universal (7/8/9 Gen universal)', es: 'Universal (Gen 7/8/9 universal)' }, 
      filmComp: { zh: '10.2寸组', en: '10.2-inch Group', es: 'Grupo 10.2 pulgadas' }, 
      note: { zh: '有Home键/非全贴合屏', en: 'With Home button/Non-laminated screen', es: 'Con botón Home/Pantalla no laminada' }, 
      specialWarning: false, order: 10 
    },
    { 
      id: 11, 
      group: { zh: 'iPad Pro/Air', en: 'iPad Pro/Air', es: 'iPad Pro/Air' }, 
      name: { zh: 'Pro 10.5 / Air 3 (2019)', en: 'Pro 10.5 / Air 3 (2019)', es: 'Pro 10.5 / Air 3 (2019)' }, 
      years: { zh: 'Pro 10.5/Air 3', en: 'Pro 10.5/Air 3', es: 'Pro 10.5/Air 3' }, 
      caseComp: { zh: '通用 (孔位基本兼容)', en: 'Universal (Cutouts basically compatible)', es: 'Universal (Cortes básicamente compatibles)' }, 
      filmComp: { zh: '10.5寸组', en: '10.5-inch Group', es: 'Grupo 10.5 pulgadas' }, 
      note: { zh: '有Home键/超窄边框', en: 'With Home button/Ultra-narrow bezels', es: 'Con botón Home/Bordes ultrafinos' }, 
      specialWarning: false, order: 11 
    },
    { 
      id: 12, 
      group: { zh: 'iPad mini', en: 'iPad mini', es: 'iPad mini' }, 
      name: { zh: 'mini 6 (2021) / mini 7 (2024)', en: 'mini 6 (2021) / mini 7 (2024)', es: 'mini 6 (2021) / mini 7 (2024)' }, 
      years: { zh: '6/7代', en: '6th/7th Gen', es: 'Gen 6/7' }, 
      caseComp: { zh: '通用 (外观完全一致)', en: 'Universal (Identical appearance)', es: 'Universal (Apariencia idéntica)' }, 
      filmComp: { zh: 'mini 6/7组', en: 'mini 6/7 Group', es: 'Grupo mini 6/7' }, 
      note: { zh: '全面屏/顶部指纹', en: 'Full screen/Top fingerprint', es: 'Pantalla completa/Lector de huellas superior' }, 
      specialWarning: false, order: 12 
    },
    { 
      id: 13, 
      group: { zh: 'iPad mini', en: 'iPad mini', es: 'iPad mini' }, 
      name: { zh: 'mini 4 / mini 5', en: 'mini 4 / mini 5', es: 'mini 4 / mini 5' }, 
      years: { zh: '4/5代', en: '4th/5th Gen', es: 'Gen 4/5' }, 
      caseComp: { zh: '通用 (仅麦克风孔位微差)', en: 'Universal (Only mic hole slightly different)', es: 'Universal (Solo麦克风孔位略有不同)' }, 
      filmComp: { zh: 'mini 4/5组', en: 'mini 4/5 Group', es: 'Grupo mini 4/5' }, 
      note: { zh: '有Home键', en: 'With Home button', es: 'Con botón Home' }, 
      specialWarning: false, order: 13 
    },
    { 
      id: 14, 
      group: { zh: 'iPad 早期款', en: 'iPad Early Models', es: 'iPad Modelos Antiguos' }, 
      name: { zh: 'iPad 5 / 6 / Air 1 / Air 2', en: 'iPad 5 / 6 / Air 1 / Air 2', es: 'iPad 5 / 6 / Air 1 / Air 2' }, 
      years: { zh: '5/6/Air 1/2', en: '5th/6th/Air 1/2', es: 'Gen 5/6/Air 1/2' }, 
      caseComp: { zh: '不通用 (厚度/开孔各异)', en: 'Not Universal (Different thickness/openings)', es: 'No Universal (Grosor/agujeros diferentes)' }, 
      filmComp: { zh: '9.7寸组', en: '9.7-inch Group', es: 'Grupo 9.7 pulgadas' }, 
      note: { zh: '有Home键/经典尺寸', en: 'With Home button/Classic size', es: 'Con botón Home/Tamaño clásico' }, 
      specialWarning: false, order: 14 
    }
  ];
}

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Supabase Auth setup
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tgxabfhwcggkqfqhhlde.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_nEbL17lus2weRuSiynNrmA_xk_c4Z2B';
const supabase = createClient ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const supabaseAnonKey = SUPABASE_ANON_KEY;
const supabaseAdmin = process.env.SUPABASE_SERVICE_KEY && createClient ? createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY) : null;

function isAdminEmail(email) {
  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return adminEmails.includes((email || '').toLowerCase());
}

// Auth middleware
async function authMiddleware(req, res, next) {
  if (!supabase) return res.status(503).json({ error: 'Auth unavailable' });
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid token' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ============ AUTH ============
app.get('/api/auth/status', (req, res) => {
  res.json({ supabaseConfigured: true });
});

app.get('/api/auth/me', async (req, res) => {
  if (!supabase) return res.json({ user: null, error: 'Auth unavailable' });
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.json({ user: null });
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.json({ user: null });
    let phone = '', store = '', avatar_url = '', profileRole = '';
    try {
      if (supabaseAdmin) {
        const { data: profile } = await supabaseAdmin.from('profiles').select('phone,store,avatar_url,role').eq('id', user.id).maybeSingle();
        if (profile) { phone = profile.phone || ''; store = profile.store || ''; avatar_url = profile.avatar_url || ''; profileRole = profile.role || ''; }
      }
    } catch {}
    const isAdmin = profileRole === 'admin';
    res.json({
      user: { id: user.id, email: user.email, name: user.user_metadata?.full_name || user.email, phone, store, avatar_url, role: isAdmin ? 'admin' : 'member' }
    });
  } catch {
    res.json({ user: null });
  }
});

// ============ MEMBER APIs (via profiles table + RLS) ============

app.put('/api/member/update', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Invalid token' });
    const { name, phone, store } = req.body;
    if (!supabaseAdmin) return res.status(503).json({ error: 'Service key not configured' });
    const updates = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.full_name = name;
    if (phone !== undefined) updates.phone = phone;
    if (store !== undefined) updates.store = store;
    const { error } = await supabaseAdmin.from('profiles').upsert({ id: user.id, ...updates });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/member/change-password', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Invalid token' });
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword) return res.status(400).json({ error: '请填写旧密码', code: 'enter_old_password' });
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: '密码至少6位', code: 'password_min_6' });
    if (!user.email) return res.status(400).json({ error: '当前账号缺少邮箱，无法验证旧密码' });

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: signInData, error: signInError } = await userClient.auth.signInWithPassword({
      email: user.email,
      password: oldPassword
    });
    if (signInError || !signInData.session) return res.status(400).json({ error: '旧密码不正确', code: 'old_password_incorrect' });

    const { error: updateError } = await userClient.auth.updateUser({ password: newPassword });
    if (updateError) return res.status(400).json({ error: updateError.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Avatar upload
app.put('/api/member/avatar', uploadMemory.single('avatar'), async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Invalid token' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!supabaseAdmin) return res.status(503).json({ error: 'Service key not configured' });
    const fileExt = req.file.originalname.split('.').pop() || 'png';
    const filePath = `${user.id}-${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabaseAdmin.storage.from('avatars').upload(filePath, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
    if (uploadError) return res.status(400).json({ error: uploadError.message });
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/avatars/${filePath}`;
    await supabaseAdmin.from('profiles').upsert({ id: user.id, avatar_url: publicUrl, updated_at: new Date().toISOString() });
    res.json({ avatarUrl: publicUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ PUBLIC APIs ============
// Get localized text from a field that may be string or {zh,en,es}
function getLocalized(field, lang) {
  if (!field) return '';
  // Handle legacy string format (migrate to object)
  if (typeof field === 'string') {
    return field; // Return as-is for legacy data
  }
  return field[lang] || field.zh || '';
}

// Migrate legacy string-format item to multi-language format
function migrateToMultiLang(item) {
  if (typeof item.name === 'string') {
    // Legacy format - get translations from defaults if available
    const defaults = getDefaultiPadData();
    const matched = defaults.find(d => d.name.zh === item.name || d.name === item.name);
    if (matched) {
      // Use the full multi-language default
      return matched;
    }
    // No match found - convert to multi-language with same content
    item.name = { zh: item.name, en: item.name, es: item.name };
    item.group = { zh: item.group || '', en: item.group || '', es: item.group || '' };
    item.years = { zh: item.years || '', en: item.years || '', es: item.years || '' };
    item.caseComp = { zh: item.caseComp || '', en: item.caseComp || '', es: item.caseComp || '' };
    item.filmComp = { zh: item.filmComp || '', en: item.filmComp || '', es: item.filmComp || '' };
    item.note = { zh: item.note || '', en: item.note || '', es: item.note || '' };
  }
  return item;
}

app.get('/api/ipad', async (req, res) => {
  const data = await readPublicDB();
  const lang = req.query.lang || 'zh';
  const q = (req.query.q || '').toLowerCase();
  let items = data.ipad || [];
  if (items.length === 0) items = readBundledDBData().ipad || [];
  
  // Search in Chinese for matching (assuming original data is Chinese)
  if (q) {
    items = items.filter(i => {
      const zhName = getLocalized(i.name, 'zh').toLowerCase();
      const zhGroup = getLocalized(i.group, 'zh').toLowerCase();
      const zhCase = getLocalized(i.caseComp, 'zh').toLowerCase();
      const zhFilm = getLocalized(i.filmComp, 'zh').toLowerCase();
      const zhNote = getLocalized(i.note, 'zh').toLowerCase();
      return zhName.includes(q) || zhGroup.includes(q) || zhCase.includes(q) || zhFilm.includes(q) || zhNote.includes(q);
    });
  }
  
  // Return data in requested language
  const localized = items.map(item => ({
    id: item.id,
    group: getLocalized(item.group, lang),
    name: getLocalized(item.name, lang),
    years: getLocalized(item.years, lang),
    caseComp: getLocalized(item.caseComp, lang),
    filmComp: getLocalized(item.filmComp, lang),
    note: getLocalized(item.note, lang),
    specialWarning: item.specialWarning,
    order: item.order
  }));
  
  res.json(localized);
});

app.get('/api/watch', async (req, res) => {
  const data = await readPublicDB();
  const lang = req.query.lang || 'zh';
  const q = (req.query.q || '').toLowerCase();
  let items = data.watch || [];
  if (items.length === 0) items = readBundledDBData().watch || [];
  
  // Search in Chinese for matching
  if (q) {
    items = items.filter(i => {
      const zhName = getLocalized(i.name, 'zh').toLowerCase();
      const zhGroup = getLocalized(i.group, 'zh').toLowerCase();
      const zhCase = getLocalized(i.caseComp, 'zh').toLowerCase();
      return zhName.includes(q) || zhGroup.includes(q) || zhCase.includes(q);
    });
  }
  
  // Return data in requested language
  const localized = items.map(item => ({
    id: item.id,
    group: getLocalized(item.group, lang),
    name: getLocalized(item.name, lang),
    years: getLocalized(item.years, lang),
    bandGroup: getLocalized(item.bandGroup, lang),
    caseComp: getLocalized(item.caseComp, lang),
    filmComp: getLocalized(item.filmComp, lang),
    screenFeature: getLocalized(item.screenFeature, lang),
    note: getLocalized(item.note, lang),
    specialWarning: item.specialWarning,
    order: item.order
  }));
  
  res.json(localized);
});

app.get('/api/film', async (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  const brand = req.query.brand || '';

  // Track search query (don't block the response)
  if (q) {
    (async () => {
      try {
        const db = await readDB();
        const stats = db.filmSearchStats || [];
        const existing = stats.find(s => s.query === q);
        if (existing) {
          existing.count++;
          existing.lastSearched = new Date().toISOString();
        } else {
          stats.push({ query: q, count: 1, lastSearched: new Date().toISOString() });
        }
        db.filmSearchStats = stats.slice(-500); // Keep last 500 searches
        await writeDB(db);
      } catch (err) {
        console.error('[film-stats] Failed to track search:', err.message);
      }
    })();
  }

  // Read from xlsx
  const filmData = readFilmFromXlsx();

  let results = {};
  for (const [k, v] of Object.entries(filmData)) {
    const entries = v.filter(e => {
      const brandMatch = !brand || e.brand === brand;
      const modelLower = e.models.toLowerCase();
      const brandLower = e.brand.toLowerCase();

      // If query has multiple words, treat first word as brand, rest as model search
      const qParts = q.split(/\s+/);
      let qMatch = false;
      if (!q) {
        qMatch = true;
      } else if (qParts.length >= 2) {
        // Multi-word: first word might be brand, check if any part matches brand or model
        const firstPart = qParts[0];
        const restParts = qParts.slice(1).join(' ');
        const isFirstPartBrand = brandLower.includes(firstPart);
        if (isFirstPartBrand) {
          // Brand + model search: rest should match models
          qMatch = modelLower.includes(restParts) || k.toLowerCase().includes(restParts);
        } else {
          // Regular multi-word: all parts should match somewhere
          qMatch = qParts.every(p => modelLower.includes(p) || brandLower.includes(p) || k.toLowerCase().includes(p));
        }
      } else {
        // Single word: just search everywhere
        qMatch = modelLower.includes(q) || brandLower.includes(q) || k.toLowerCase().includes(q);
      }

      return brandMatch && qMatch;
    });
    if (entries.length) results[k] = entries;
  }
  res.json(results);
});

app.get('/api/settings', async (req, res) => {
  const db = await readPublicDB();
  res.json(db.settings || DEFAULT_SETTINGS);
});

const PRODUCT_TRANSLATIONS = {
  zh: {
    nav_products: '产品素材',
    products_title: '产品素材库',
    products_search_placeholder: '搜索 SKU 或名称...',
    products_all_categories: '所有分类',
    products_empty: '没有找到产品',
    products_loading: '加载中...',
    products_count: '共 {count} 个产品',
    products_filtered_count: '共 {count} 个产品 (筛选自 {total} 个)',
    product_images: '图片',
    product_videos: '视频',
    product_docs: '文案',
    product_image_resources: '图片资源',
    product_video_resources: '视频资源',
    product_descriptions: '文案与描述',
    product_download: '下载',
    product_download_all: '下载全部',
    product_download_selected: '下载选中...',
    product_packaging: '打包中...',
    product_download_invalid: '下载链接无效',
    product_jszip_missing: 'JSZip 未加载',
    product_packaged: '已打包 {count} 张图片',
    product_pack_failed: '打包失败: {message}',
    product_copy_all: '复制全部',
    product_copied: '✓ 已复制',
    product_copy_failed: '复制失败',
    product_no_image: '无图'
    ,product_main_image: '主产品图',
    product_group_image2: '产品海报',
    product_group_image3: '产品展示',
    product_group_image4: '使用场景图',
    product_lang_es: '西语版',
    product_lang_zh: '中文版',
    product_video_ad: '广告视频',
    product_video_tutorial: '使用说明视频',
    admin_sync_products: '同步产品素材',
    admin_syncing_products: '同步中...',
    admin_sync_products_success: '产品素材已同步，共 {count} 个产品',
    admin_sync_products_failed: '同步失败: {message}'
  },
  es: {
    nav_products: 'Materiales',
    products_title: 'Biblioteca de materiales',
    products_search_placeholder: 'Buscar SKU o nombre...',
    products_all_categories: 'Todas las categorías',
    products_empty: 'No se encontraron productos',
    products_loading: 'Cargando...',
    products_count: '{count} productos',
    products_filtered_count: '{count} productos (filtrados de {total})',
    product_images: 'Imágenes',
    product_videos: 'Vídeos',
    product_docs: 'Textos',
    product_image_resources: 'Recursos de imagen',
    product_video_resources: 'Recursos de vídeo',
    product_descriptions: 'Textos y descripciones',
    product_download: 'Descargar',
    product_download_all: 'Descargar todo',
    product_download_selected: 'Descargando seleccionados...',
    product_packaging: 'Comprimiendo...',
    product_download_invalid: 'Enlace de descarga no válido',
    product_jszip_missing: 'JSZip no está cargado',
    product_packaged: '{count} imágenes comprimidas',
    product_pack_failed: 'Error al comprimir: {message}',
    product_copy_all: 'Copiar todo',
    product_copied: '✓ Copiado',
    product_copy_failed: 'Error al copiar',
    product_no_image: 'Sin imagen',
    product_main_image: 'Imagen principal',
    product_group_image2: 'Cartel de producto',
    product_group_image3: 'Presentación del producto',
    product_group_image4: 'Escena de uso',
    product_lang_es: 'Versión ES',
    product_lang_zh: 'Versión CN',
    product_video_ad: 'Vídeo publicitario',
    product_video_tutorial: 'Vídeo tutorial',
    admin_sync_products: 'Sincronizar materiales',
    admin_syncing_products: 'Sincronizando...',
    admin_sync_products_success: 'Materiales sincronizados: {count} productos',
    admin_sync_products_failed: 'Error al sincronizar: {message}'
  },
  en: {
    nav_products: 'Assets',
    products_title: 'Product Asset Library',
    products_search_placeholder: 'Search SKU or name...',
    products_all_categories: 'All categories',
    products_empty: 'No products found',
    products_loading: 'Loading...',
    products_count: '{count} products',
    products_filtered_count: '{count} products (filtered from {total})',
    product_images: 'Images',
    product_videos: 'Videos',
    product_docs: 'Copy',
    product_image_resources: 'Image Assets',
    product_video_resources: 'Video Assets',
    product_descriptions: 'Copy and Descriptions',
    product_download: 'Download',
    product_download_all: 'Download all',
    product_download_selected: 'Downloading selected...',
    product_packaging: 'Packaging...',
    product_download_invalid: 'Invalid download link',
    product_jszip_missing: 'JSZip is not loaded',
    product_packaged: 'Packaged {count} images',
    product_pack_failed: 'Packaging failed: {message}',
    product_copy_all: 'Copy all',
    product_copied: '✓ Copied',
    product_copy_failed: 'Copy failed',
    product_no_image: 'No image',
    product_main_image: 'Main image',
    product_group_image2: 'Product poster',
    product_group_image3: 'Product showcase',
    product_group_image4: 'Usage scene',
    product_lang_es: 'Spanish version',
    product_lang_zh: 'Chinese version',
    product_video_ad: 'Ad video',
    product_video_tutorial: 'Tutorial video',
    admin_sync_products: 'Sync product assets',
    admin_syncing_products: 'Syncing...',
    admin_sync_products_success: 'Product assets synced: {count} products',
    admin_sync_products_failed: 'Sync failed: {message}'
  }
};

function getTranslationTexts(lang, dbTranslations = {}) {
  return {
    ...(DEFAULT_TRANSLATIONS[lang] || DEFAULT_TRANSLATIONS.zh),
    ...(PRODUCT_TRANSLATIONS[lang] || PRODUCT_TRANSLATIONS.zh),
    ...(dbTranslations[lang] || {})
  };
}

// Translations API
app.get('/api/translations', async (req, res) => {
  const lang = req.query.lang || 'zh';
  const db = await readPublicDB();
  const translations = db.translations || {};
  res.json({
    lang,
    texts: getTranslationTexts(lang, translations)
  });
});

// Film search stats API
app.get('/api/admin/film-search-stats', authMiddleware, async (req, res) => {
  const db = await readDB();
  const stats = db.filmSearchStats || [];
  // Sort by count descending, return top 50
  const top = stats.sort((a, b) => b.count - a.count).slice(0, 50);
  res.json(top);
});

app.post('/api/track-visit', async (req, res) => {
  try {
    const db = await readDB();
    const today = new Date().toISOString().slice(0, 10);
    const siteVisits = db.siteVisits || { total: 0, byDate: {}, pages: {}, referrers: {} };
    const pathName = String(req.body?.path || req.path || '/').slice(0, 120);
    let referrer = 'Direct';
    try {
      const rawReferrer = String(req.body?.referrer || '').trim();
      if (rawReferrer) referrer = new URL(rawReferrer).hostname || rawReferrer.slice(0, 80);
    } catch {
      referrer = String(req.body?.referrer || 'Direct').slice(0, 80) || 'Direct';
    }
    siteVisits.total = Number(siteVisits.total || 0) + 1;
    siteVisits.byDate = siteVisits.byDate || {};
    siteVisits.pages = siteVisits.pages || {};
    siteVisits.referrers = siteVisits.referrers || {};
    siteVisits.byDate[today] = Number(siteVisits.byDate[today] || 0) + 1;
    siteVisits.pages[pathName] = Number(siteVisits.pages[pathName] || 0) + 1;
    siteVisits.referrers[referrer] = Number(siteVisits.referrers[referrer] || 0) + 1;
    db.siteVisits = siteVisits;
    await writeDB(db);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function sumVisitsByDate(byDate, days) {
  let total = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    total += Number(byDate?.[key] || 0);
  }
  return total;
}

function topEntries(obj, keyName, limit = 10) {
  return Object.entries(obj || {})
    .map(([key, count]) => ({ [keyName]: key, count: Number(count || 0) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

app.get('/api/admin/traffic-stats', authMiddleware, async (req, res) => {
  const db = await readDB();
  const today = new Date().toISOString().slice(0, 10);
  const siteVisits = db.siteVisits || { total: 0, byDate: {}, pages: {}, referrers: {} };
  const daily = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    daily.push({ date: key, count: Number(siteVisits.byDate?.[key] || 0) });
  }
  res.json({
    totalVisits: Number(siteVisits.total || 0),
    todayVisits: Number(siteVisits.byDate?.[today] || 0),
    last7Days: sumVisitsByDate(siteVisits.byDate, 7),
    last30Days: sumVisitsByDate(siteVisits.byDate, 30),
    daily,
    topPages: topEntries(siteVisits.pages, 'path'),
    referrers: topEntries(siteVisits.referrers, 'referrer')
  });
});

// ============ ADMIN APIs ============
// iPad CRUD
app.get('/api/admin/ipad', authMiddleware, async (req, res) => {
  const db = await readDB();
  // Migrate legacy data to multi-language format
  let sourceItems = db.ipad || [];
  if (sourceItems.length === 0) {
    sourceItems = readBundledDBData().ipad || [];
    db.ipad = sourceItems.map(migrateToMultiLang);
    await writeDB(db);
  }
  const items = sourceItems.map(migrateToMultiLang);
  res.json(items);
});

app.post('/api/admin/ipad', authMiddleware, async (req, res) => {
  const db = await readDB();
  const item = { ...req.body, id: Date.now(), createdAt: new Date().toISOString() };
  db.ipad = db.ipad || [];
  db.ipad.push(item);
  await writeDB(db);
  res.json(item);
});

app.put('/api/admin/ipad/:id', authMiddleware, async (req, res) => {
  const db = await readDB();
  const idx = db.ipad.findIndex(i => String(i.id) === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  db.ipad[idx] = { ...db.ipad[idx], ...req.body };
  await writeDB(db);
  res.json(db.ipad[idx]);
});

app.delete('/api/admin/ipad/:id', authMiddleware, async (req, res) => {
  const db = await readDB();
  db.ipad = db.ipad.filter(i => String(i.id) !== req.params.id);
  await writeDB(db);
  res.json({ ok: true });
});

// Watch CRUD
app.get('/api/admin/watch', authMiddleware, async (req, res) => {
  const db = await readDB();
  // Migrate legacy data to multi-language format
  let sourceItems = db.watch || [];
  if (sourceItems.length === 0) {
    sourceItems = readBundledDBData().watch || [];
    db.watch = sourceItems.map(migrateToMultiLang);
    await writeDB(db);
  }
  const items = sourceItems.map(migrateToMultiLang);
  res.json(items);
});

app.post('/api/admin/watch', authMiddleware, async (req, res) => {
  const db = await readDB();
  const item = { ...req.body, id: Date.now(), createdAt: new Date().toISOString() };
  db.watch = db.watch || [];
  db.watch.push(item);
  await writeDB(db);
  res.json(item);
});

app.put('/api/admin/watch/:id', authMiddleware, async (req, res) => {
  const db = await readDB();
  const idx = db.watch.findIndex(i => String(i.id) === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  db.watch[idx] = { ...db.watch[idx], ...req.body };
  await writeDB(db);
  res.json(db.watch[idx]);
});

app.delete('/api/admin/watch/:id', authMiddleware, async (req, res) => {
  const db = await readDB();
  db.watch = db.watch.filter(i => String(i.id) !== req.params.id);
  await writeDB(db);
  res.json({ ok: true });
});

// Film groups CRUD (full-glue)
app.post('/api/admin/film/fg', authMiddleware, async (req, res) => {
  const db = await readDB();
  const { filmName, brand, models } = req.body;
  if (!db.film) db.film = { fullGlue: {}, twoPointFiveD: [], privacy: [] };
  if (!db.film.fullGlue[filmName]) db.film.fullGlue[filmName] = [];
  db.film.fullGlue[filmName].push({ brand, models });
  await writeDB(db);
  res.json({ ok: true });
});

app.put('/api/admin/film/fg/:filmName', authMiddleware, async (req, res) => {
  const db = await readDB();
  const originalName = decodeURIComponent(req.params.filmName);
  const { entries, newName } = req.body;
  if (!db.film) db.film = { fullGlue: {}, twoPointFiveD: [], privacy: [] };
  if (!db.film.fullGlue) db.film.fullGlue = {};
  const targetName = String(newName || originalName).trim();
  if (!targetName || !Array.isArray(entries)) return res.status(400).json({ error: 'Invalid film group data' });
  if (targetName !== originalName) delete db.film.fullGlue[originalName];
  db.film.fullGlue[targetName] = entries;
  await writeDB(db);
  res.json({ ok: true });
});

app.delete('/api/admin/film/fg/:filmName', authMiddleware, async (req, res) => {
  const db = await readDB();
  delete db.film.fullGlue[decodeURIComponent(req.params.filmName)];
  await writeDB(db);
  res.json({ ok: true });
});

// Logo upload
app.post('/api/admin/logo', authMiddleware, uploadMemory.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const db = await readDB();
  const mimeType = req.file.mimetype || 'image/png';
  const logoDataUrl = `data:${mimeType};base64,${req.file.buffer.toString('base64')}`;
  db.settings = { ...(db.settings || DEFAULT_SETTINGS), logoDataUrl };
  await writeDB(db);
  res.json({ ok: true, logoDataUrl });
});

app.post('/api/admin/favicon', authMiddleware, uploadMemory.single('favicon'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const db = await readDB();
  const mimeType = req.file.mimetype || 'image/x-icon';
  const faviconDataUrl = `data:${mimeType};base64,${req.file.buffer.toString('base64')}`;
  db.settings = { ...(db.settings || DEFAULT_SETTINGS), faviconDataUrl, faviconMimeType: mimeType };
  await writeDB(db);
  res.json({ ok: true, faviconDataUrl, faviconMimeType: mimeType });
});

// Settings
app.put('/api/admin/settings', authMiddleware, async (req, res) => {
  const db = await readDB();
  db.settings = { ...db.settings, ...req.body };
  await writeDB(db);
  res.json(db.settings);
});

// Translations admin
app.get('/api/admin/translations', authMiddleware, async (req, res) => {
  const db = await readDB();
  const translations = db.translations || {};
  res.json({
    zh: getTranslationTexts('zh', translations),
    en: getTranslationTexts('en', translations),
    es: getTranslationTexts('es', translations)
  });
});

app.put('/api/admin/translations', authMiddleware, async (req, res) => {
  const db = await readDB();
  const { zh, en, es } = req.body;
  if (!db.translations) db.translations = {};
  if (zh) db.translations.zh = { ...DEFAULT_TRANSLATIONS.zh, ...PRODUCT_TRANSLATIONS.zh, ...zh };
  if (en) db.translations.en = { ...DEFAULT_TRANSLATIONS.en, ...PRODUCT_TRANSLATIONS.en, ...en };
  if (es) db.translations.es = { ...DEFAULT_TRANSLATIONS.es, ...PRODUCT_TRANSLATIONS.es, ...es };
  await writeDB(db);
  res.json({ ok: true });
});

// Amazon category translations
app.get('/api/amazon-categories', async (req, res) => {
  const db = await readPublicDB();
  res.json(db.amazonCategories || {});
});

app.put('/api/admin/amazon-categories', authMiddleware, async (req, res) => {
  const db = await readDB();
  db.amazonCategories = req.body;
  await writeDB(db);
  res.json({ ok: true });
});

// Users from Supabase Auth
app.get('/api/admin/users', authMiddleware, requireAdmin, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY is not configured' });
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) return res.status(500).json({ error: error.message });
  // Fetch roles from profiles table
  let profileRoles = {};
  try {
    const { data: profiles } = await supabaseAdmin.from('profiles').select('id,full_name,role,phone,store');
    if (profiles) profiles.forEach(p => {
      profileRoles[p.id] = {
        name: p.full_name || '',
        role: p.role || 'member',
        phone: p.phone || '',
        store: p.store || ''
      };
    });
  } catch {}
  const users = (data.users || []).map(user => ({
    id: user.id,
    username: user.email || user.phone || user.id,
    email: user.email || '',
    name: profileRoles[user.id]?.name || user.user_metadata?.full_name || user.email || user.id,
    phone: profileRoles[user.id]?.phone || '',
    store: profileRoles[user.id]?.store || '',
    role: profileRoles[user.id]?.role || 'member',
    createdAt: user.created_at
  }));
  res.json(users);
});

app.put('/api/admin/users/:id', authMiddleware, requireAdmin, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY is not configured' });
  const { name, phone, store, role, password } = req.body;
  if (role && !['admin', 'member'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (password && String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  // Update auth metadata
  const metadata = {};
  if (name !== undefined) metadata.full_name = name;
  const authUpdate = {};
  if (Object.keys(metadata).length > 0) authUpdate.user_metadata = metadata;
  if (password) authUpdate.password = String(password);
  if (Object.keys(authUpdate).length > 0) {
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(req.params.id, authUpdate);
    if (updateError) return res.status(400).json({ error: updateError.message });
  }
  // Update profiles table
  const profileUpdate = {};
  if (name !== undefined) profileUpdate.full_name = name;
  if (phone !== undefined) profileUpdate.phone = phone;
  if (store !== undefined) profileUpdate.store = store;
  if (role !== undefined) profileUpdate.role = role;
  profileUpdate.updated_at = new Date().toISOString();
  await supabaseAdmin.from('profiles').upsert({ id: req.params.id, ...profileUpdate }).catch(() => {});
  res.json({ ok: true });
});

app.post('/api/admin/users', authMiddleware, requireAdmin, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY is not configured' });
  const email = String(req.body.email || req.body.username || '').trim();
  const password = String(req.body.password || '');
  const name = String(req.body.name || email).trim();
  const phone = String(req.body.phone || '').trim();
  const store = String(req.body.store || '').trim();
  const role = ['admin', 'member'].includes(req.body.role) ? req.body.role : 'member';
  if (!email || password.length < 6) return res.status(400).json({ error: 'Email and password >= 6 characters are required' });
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name }
  });
  if (error) return res.status(500).json({ error: error.message });
  if (data.user?.id) {
    await supabaseAdmin.from('profiles').upsert({
      id: data.user.id,
      full_name: name,
      phone,
      store,
      role,
      updated_at: new Date().toISOString()
    }).catch(() => {});
  }
  res.json({ ok: true, id: data.user?.id });
});

app.delete('/api/admin/users/:id', authMiddleware, requireAdmin, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY is not configured' });
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete current user' });
  const { error } = await supabaseAdmin.auth.admin.deleteUser(req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// --- Product Sync to PostgreSQL ---
const SHEET_ID = process.env.PRODUCT_SHEET_ID || '10C954V-_NJU7dCO9M7Ts1pLudCk8F8BrhCXcsRqT12M';
const SHEET_NAME = process.env.PRODUCT_SHEET_NAME || 'Sheet1';
let productSyncInterval = null;

async function syncProductsToDB() {
  console.log('[product-sync] Starting Google Sheet sync...');
  try {
    await connectDB();
    if (!pool) throw new Error('Database is not connected; check DATABASE_URL');
    await ensureProductSchema();
    const products = await fetchProductsFromGoogleSheet();
    if (products && products.length > 0 && pool) {
      const client = await pool.connect();
      try {
        await client.query('DELETE FROM products');
        for (const p of products) {
          await client.query(
            'INSERT INTO products (sku, data, synced_at) VALUES ($1, $2, NOW()) ON CONFLICT (sku) DO UPDATE SET data = $2, synced_at = NOW()',
            [p.sku, JSON.stringify(p)]
          );
        }
        await client.query(
          'INSERT INTO products_meta (id, count, source, updated_at) VALUES (\'syncMeta\', $1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET count = $1, source = $2, updated_at = NOW()',
          [products.length, 'google-sheet']
        );
        console.log(`[product-sync] ✅ Synced ${products.length} products`);
      } finally {
        client.release();
      }
    } else if (!pool) {
      console.warn('[product-sync] ⚠️  No database, skipping product storage');
    }
    return products || [];
  } catch (err) {
    console.error('[product-sync] ❌ Sync failed:', err.message);
    throw err;
  }
}

// --- Amazon & Film Data Sync to Supabase ---
const AMAZON_SHEET_ID = process.env.AMAZON_SHEET_ID || '10C954V-_NJU7dCO9M7Ts1pLudCk8F8BrhCXcsRqT12M';
const AMAZON_SHEET_NAME = process.env.AMAZON_SHEET_NAME || 'latest';

async function syncAmazonToDB() {
  await connectDB();
  if (!pool) throw new Error('Database is not connected; check DATABASE_URL');
  await ensureProductSchema();
  if (!pool) { console.warn('[amazon-sync] ⚠️  No database'); return; }
  console.log('[amazon-sync] Fetching from Google Sheet...');
  try {
    const url = `https://docs.google.com/spreadsheets/d/${AMAZON_SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(AMAZON_SHEET_NAME)}`;
    const { data } = await axios.get(url, { timeout: 30000 });
    const match = data.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)/);
    if (!match) throw new Error('Invalid gviz response');
    const json = JSON.parse(match[1]);
    const rows = (json.table?.rows || []).map(row => {
      const c = row.c || [];
      const categoryRaw = c[0]?.v || '';
      return { categoryRaw, category: categoryRaw, type: c[1]?.v||'', rank: parseInt(c[2]?.v)||0, title: c[3]?.v||'', price: c[4]?.v||'', rating: c[5]?.v||'', reviews: c[6]?.v||'', imageUrl: c[7]?.v||'', productUrl: c[8]?.v||'', updatedAt: c[9]?.v||'' };
    }).filter(r => r.title && r.title !== 'Title' && r.rank > 0);
    if (rows.length === 0) throw new Error('No valid Amazon rows found; check AMAZON_SHEET_ID and AMAZON_SHEET_NAME');
    await pool.query('INSERT INTO app_data (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()', ['amazon', JSON.stringify(rows)]);
    console.log(`[amazon-sync] ✅ Synced ${rows.length} items`);
    return rows.length;
  } catch (err) {
    console.error('[amazon-sync] ❌ Failed:', err.message);
    throw err;
  }
}

async function syncFilmToDB() {
  await connectDB();
  if (!pool) throw new Error('Database is not connected; check DATABASE_URL');
  await ensureProductSchema();
  if (!pool) return;
  const filmData = readFilmFromXlsx();
  if (Object.keys(filmData).length > 0) {
    await pool.query('INSERT INTO app_data (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()', ['film', JSON.stringify(filmData)]);
    console.log(`[film-sync] ✅ Synced ${Object.keys(filmData).length} film groups`);
  }
  return Object.keys(filmData).length;
}

app.get('/api/admin/sync/amazon', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const count = await syncAmazonToDB();
    res.json({ ok: true, count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/sync/film', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const count = await syncFilmToDB();
    res.json({ ok: true, count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/sync/all', authMiddleware, requireAdmin, async (req, res) => {
  try {
    await syncProductsToDB();
    await syncAmazonToDB();
    await syncFilmToDB();
    await syncGoogleToDB();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Google Sheet Sync ---
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || '1UdyeRo6vo-VR-Maut0ryAiJJ0tU6obQqdFIcWfnzZPQ';
const GOOGLE_SHEET_GID = process.env.GOOGLE_SHEET_GID || '1211820114';
const GOOGLE_SHEET_NAME = process.env.GOOGLE_SHEET_NAME || '';

async function syncGoogleToDB() {
  await connectDB();
  if (!pool) throw new Error('Database is not connected');
  console.log('[google-sync] Fetching from Google Sheet...');
  try {
    let url = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:json`;
    if (GOOGLE_SHEET_NAME) url += `&sheet=${encodeURIComponent(GOOGLE_SHEET_NAME)}`;
    else url += `&gid=${GOOGLE_SHEET_GID}`;
    const { data } = await axios.get(url, { timeout: 30000 });
    const match = data.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)/);
    if (!match) throw new Error('Invalid gviz response');
    const json = JSON.parse(match[1]);
    const cols = json.table?.cols || [];
    const rows = (json.table?.rows || []).map(row => {
      const c = row.c || [];
      return { rank: parseInt(c[0]?.v)||0, title: c[1]?.v||'', brand: c[2]?.v||'', trend: c[3]?.v||'', prevRank: c[4]?.v||'', category: c[5]?.v||'', country: c[6]?.v||'', date: c[7]?.v||'' };
    }).filter(r => r.title && r.title !== 'Title' && r.rank > 0);
    console.log(`[google-sync] Columns found: ${cols.map(col => col.label || col.id).join(', ')}`);
    console.log(`[google-sync] Sample row: ${JSON.stringify(rows[0] || 'none')}`);
    if (rows.length === 0) throw new Error('No valid Google rows found - check column mapping');
    await pool.query('INSERT INTO app_data (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()', ['google', JSON.stringify(rows)]);
    console.log(`[google-sync] ✅ Synced ${rows.length} items`);
    return rows.length;
  } catch (err) {
    console.error('[google-sync] ❌ Failed:', err.message);
    throw err;
  }
}

app.get('/api/admin/sync/google', authMiddleware, requireAdmin, async (req, res) => {
  try { const count = await syncGoogleToDB(); res.json({ ok: true, count }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/google', async (req, res) => {
  await connectDB();
  if (!pool) return res.json({ data: [], source: 'no-db' });
  try {
    const result = await pool.query('SELECT value, updated_at FROM app_data WHERE key = $1', ['google']);
    if (result.rows.length > 0) return res.json({ data: result.rows[0].value, source: 'cache', updatedAt: result.rows[0].updated_at });
    return res.json({ data: [], source: 'empty' });
  } catch { return res.json({ data: [], source: 'error' }); }
});

app.get('/api/admin/env-status', authMiddleware, requireAdmin, async (req, res) => {
  res.json({
    hasDatabaseUrl: Boolean(PG_CONNECTION_STRING),
    databaseUrlType: PG_CONNECTION_STRING ? (PG_CONNECTION_STRING.startsWith('postgres') ? 'postgres' : 'invalid') : 'missing',
    hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
    hasSupabaseAnonKey: Boolean(process.env.SUPABASE_ANON_KEY),
    hasSupabaseServiceKey: Boolean(process.env.SUPABASE_SERVICE_KEY),
    hasProductSheetId: Boolean(process.env.PRODUCT_SHEET_ID),
    hasAmazonSheetId: Boolean(process.env.AMAZON_SHEET_ID),
    amazonSheetName: process.env.AMAZON_SHEET_NAME || 'latest'
  });
});

// Public cached API: Amazon
app.get('/api/amazon', async (req, res) => {
  await connectDB();
  await ensureProductSchema();
  if (!pool) {
    const url = `https://docs.google.com/spreadsheets/d/${AMAZON_SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(AMAZON_SHEET_NAME)}`;
    try {
      const { data } = await axios.get(url, { timeout: 15000 });
      const match = data.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)/);
      if (match) {
        const json = JSON.parse(match[1]);
        const rows = (json.table?.rows || []).map(row => {
          const c = row.c || [];
          const categoryRaw = c[0]?.v || '';
          return { categoryRaw, category: categoryRaw, type: c[1]?.v||'', rank: parseInt(c[2]?.v)||0, title: c[3]?.v||'', price: c[4]?.v||'', rating: c[5]?.v||'', reviews: c[6]?.v||'', imageUrl: c[7]?.v||'', productUrl: c[8]?.v||'', updatedAt: c[9]?.v||'' };
        }).filter(r => r.title && r.title !== 'Title');
        return res.json({ data: rows, source: 'google-sheet' });
      }
    } catch {}
    return res.json({ data: [], source: 'empty' });
  }
  try {
    const { rows } = await pool.query('SELECT value, updated_at FROM app_data WHERE key = $1', ['amazon']);
    if (rows.length > 0) {
      const data = (rows[0].value || []).map(r => ({ ...r, categoryRaw: r.categoryRaw || r.category || '' }));
      const latestDate = data.reduce((max, r) => r.updatedAt && r.updatedAt > max ? r.updatedAt : max, '');
      return res.json({ data, source: 'cache', updatedAt: rows[0].updated_at, latestDate: latestDate.split(' ')[0] || '' });
    }
    res.json({ data: [], source: 'empty' });
  } catch {
    res.json({ data: [], source: 'empty' });
  }
});

// Public cached API: Film
app.get('/api/film-cached', async (req, res) => {
  if (!pool) {
    const filmData = readFilmFromXlsx();
    return res.json(filmData);
  }
  try {
    const { rows } = await pool.query('SELECT value FROM app_data WHERE key = $1', ['film']);
    if (rows.length > 0) return res.json(rows[0].value);
  } catch {}
  const filmData = readFilmFromXlsx();
  if (Object.keys(filmData).length > 0 && pool) {
    await pool.query('INSERT INTO app_data (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()', ['film', JSON.stringify(filmData)]);
  }
  res.json(filmData);
});

async function fetchProductsFromGoogleSheet() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(SHEET_NAME)}`;
  const { data } = await axios.get(url, { timeout: 30000 });
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
  const hasImageLinks = products.some(product => product.stats.imageCount > 0);
  if (hasImageLinks) return products;

  try {
    const xlsxProducts = await fetchProductsFromGoogleSheetXlsxWithRetry();
    if (xlsxProducts.length > 0) return xlsxProducts;
  } catch (err) {
    console.error('[products] xlsx fallback failed:', err.message);
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

async function fetchProductsFromGoogleSheetXlsx() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx&sheet=${encodeURIComponent(SHEET_NAME)}`;
  const { data } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 90000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    headers: { 'User-Agent': 'Mozilla/5.0 AccessoryGuide/1.0' }
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

async function fetchProductsFromGoogleSheetXlsxWithRetry() {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fetchProductsFromGoogleSheetXlsx();
    } catch (err) {
      lastErr = err;
      console.error(`[products] xlsx fetch attempt ${attempt} failed:`, err.message);
    }
  }
  throw lastErr;
}

function parseGvizResponse(text) {
  const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\);?\s*$/);
  if (!match) throw new Error('Invalid gviz response');
  return JSON.parse(match[1]).table;
}

const COL = {
  NAME: 0, SKU: 1, CAT: 2,
  MAIN_IMG: 3, MAIN_DL: 4,
  IMG2_ES: 5, IMG2_ES_DL: 6, IMG2_ZH: 7, IMG2_ZH_DL: 8,
  IMG3_ES: 9, IMG3_ES_DL: 10, IMG3_ZH: 11, IMG3_ZH_DL: 12,
  IMG4_ES: 13, IMG4_ES_DL: 14, IMG4_ZH: 15, IMG4_ZH_DL: 16,
  DESC_ES: 17, DESC_ZH: 18, VIDEO_AD: 19, VIDEO_TUT: 20
};

function cellAt(row, idx) {
  return row.c && row.c[idx] ? row.c[idx] : null;
}

function extractDriveFileId(url) {
  if (!url) return null;
  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function extractUrlFromCell(cell) {
  if (!cell) return null;
  if (cell.l && typeof cell.l.Target === 'string' && /^https?:\/\//.test(cell.l.Target)) return cell.l.Target;
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

function toDriveDirectUrl(url) {
  if (!url) return null;
  const fileId = extractDriveFileId(url);
  if (fileId) return `https://drive.google.com/uc?export=download&id=${fileId}`;
  return url;
}

function toVideoEmbedUrl(url) {
  if (!url) return null;
  const fileId = extractDriveFileId(url);
  if (fileId) return `https://drive.google.com/file/d/${fileId}/preview`;
  return url;
}

function normalizeProductVideoUrls(product) {
  if (!product || !Array.isArray(product.videos)) return product;
  product.videos = product.videos.map(video => {
    const source = video.url || video.embedUrl || video.downloadUrl;
    const directUrl = toDriveDirectUrl(source);
    return { ...video, videoUrl: video.videoUrl || directUrl, downloadUrl: directUrl || video.downloadUrl };
  });
  return product;
}

function rowToProduct(row) {
  const sku = extractTextFromCell(cellAt(row, COL.SKU));
  if (!sku || sku.toLowerCase() === 'sku') return null;

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

  const mainImageUrl = extractUrlFromCell(cellAt(row, COL.MAIN_IMG));
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
      const imgUrl = extractUrlFromCell(cellAt(row, imgCol));
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
    product.videos.push({ type: 'ad', title: '广告视频', url: adUrl, embedUrl: toVideoEmbedUrl(adUrl), videoUrl: toDriveDirectUrl(adUrl), downloadUrl: toDriveDirectUrl(adUrl) });
    product.stats.videoCount++;
  }
  const tutorialUrl = extractUrlFromCell(cellAt(row, COL.VIDEO_TUT));
  if (tutorialUrl) {
    product.videos.push({ type: 'tutorial', title: '使用说明视频', url: tutorialUrl, embedUrl: toVideoEmbedUrl(tutorialUrl), videoUrl: toDriveDirectUrl(tutorialUrl), downloadUrl: toDriveDirectUrl(tutorialUrl) });
    product.stats.videoCount++;
  }
  if (product.descriptions.es) product.stats.docCount++;
  if (product.descriptions.zh) product.stats.docCount++;

  return product;
}

async function startDataSyncScheduler() {
  const SYNC_INTERVAL_MS = parseInt(process.env.DATA_SYNC_INTERVAL_MS || '86400000', 10);
  if (productSyncInterval) clearInterval(productSyncInterval);
  productSyncInterval = setInterval(async () => {
    console.log('[data-sync] Scheduled sync triggered');
    try {
      await syncProductsToDB();
      await syncAmazonToDB();
      await syncFilmToDB();
      await syncGoogleToDB();
    } catch (err) {
      console.error('[data-sync] Scheduled sync failed:', err.message);
    }
  }, SYNC_INTERVAL_MS);
  console.log(`[data-sync] Scheduler started, interval: ${SYNC_INTERVAL_MS}ms`);
}

// ============ PRODUCT LIBRARY (MongoDB only) ============
const productService = {
  _cache: null,
  _cacheMeta: null,

  async getAllProducts() {
    if (this._cache) return this._cache;
    await connectDB();
    await ensureProductSchema();
    if (!pool) { this._cache = []; return []; }
    try {
      const { rows } = await pool.query('SELECT data FROM products ORDER BY sku');
      this._cache = rows.map(r => normalizeProductVideoUrls(r.data));
      const meta = await pool.query('SELECT count, source, updated_at FROM products_meta WHERE id = $1', ['syncMeta']);
      this._cacheMeta = meta.rows[0] || { count: 0, source: 'empty', updatedAt: null };
    } catch (err) {
      console.error('[products] DB error:', err.message);
      this._cache = [];
    }
    return this._cache;
  },

  async getProductBySku(sku) {
    const products = await this.getAllProducts();
    return products.find(p => p.sku === sku) || null;
  },

  async getAllCategories() {
    const products = await this.getAllProducts();
    const categories = new Set();
    products.forEach(p => { if (p.category) categories.add(p.category); });
    return Array.from(categories).sort();
  },

  async searchProducts({ q, category }) {
    let products = await this.getAllProducts();
    if (category) products = products.filter(p => p.category === category);
    if (q) {
      const lower = q.toLowerCase();
      products = products.filter(p => p.sku.toLowerCase().includes(lower) || p.name.toLowerCase().includes(lower));
    }
    return products;
  },

  clearCache() {
    this._cache = null;
    this._cacheMeta = null;
  },

  getCacheMeta() {
    return this._cacheMeta;
  },

  async refresh() {
    this.clearCache();
    const products = await syncProductsToDB();
    this._cache = products;
    this._cacheMeta = { count: products.length, source: 'google-sheet', updated_at: new Date().toISOString() };
    return products;
  }
};

app.get('/api/products', async (req, res) => {
  try {
    const { q, category } = req.query;
    const products = await productService.searchProducts({ q, category });
    const lite = products.map(p => ({
      sku: p.sku, name: p.name, category: p.category,
      mainImage: p.mainImage, stats: p.stats
    }));
    res.json(lite);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/products/categories', async (req, res) => {
  try {
    res.json(await productService.getAllCategories());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/products/_debug', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const products = await productService.getAllProducts(true);
    res.json({
      count: products.length,
      sample: products[0] || null,
      allSkus: products.map(p => p.sku),
      cache: productService.getCacheMeta()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/products/cache/status', async (req, res) => {
  const cached = productService.getCacheMeta();
  res.json(cached || { source: 'empty', count: 0, updatedAt: null });
});

app.get('/api/product-cache-status', async (req, res) => {
  const cached = productService.getCacheMeta();
  res.json(cached || { source: 'empty', count: 0, updatedAt: null });
});

app.get('/api/products/image/:fileId', (req, res) => {
  const fileId = req.params.fileId;
  if (!/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    return res.status(400).json({ error: 'Invalid file id' });
  }

  const imageUrl = `https://lh3.googleusercontent.com/d/${fileId}=w1200`;
  https.get(imageUrl, upstream => {
    if (upstream.statusCode !== 200) {
      upstream.resume();
      return res.sendStatus(upstream.statusCode || 502);
    }

    res.setHeader('Content-Type', upstream.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=300');
    upstream.pipe(res);
  }).on('error', err => {
    console.error('Product image proxy failed:', err.message);
    if (!res.headersSent) res.sendStatus(502);
  });
});

app.get('/api/products/download/:fileId', async (req, res) => {
  const fileId = req.params.fileId;
  if (!/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    return res.status(400).json({ error: 'Invalid file id' });
  }

  const filename = String(req.query.filename || `${fileId}.bin`).replace(/[\\/:*?"<>|]/g, '_');
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  try {
    const upstream = await axios.get(downloadUrl, {
      responseType: 'stream',
      timeout: 90000,
      maxRedirects: 5,
      headers: { 'User-Agent': 'Mozilla/5.0 AccessoryGuide/1.0' }
    });

    res.setHeader('Content-Type', upstream.headers['content-type'] || 'application/octet-stream');
    if (upstream.headers['content-length']) {
      res.setHeader('Content-Length', upstream.headers['content-length']);
    }
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    upstream.data.pipe(res);
    upstream.data.on('error', err => {
      console.error('Product download stream failed:', err.message);
      if (!res.headersSent) res.sendStatus(502);
      else res.destroy(err);
    });
  } catch (err) {
    console.error('Product download proxy failed:', err.message);
    if (!res.headersSent) res.status(err.response?.status || 502).json({ error: 'Download failed' });
  }
});

app.get('/api/proxy/video', async (req, res) => {
  const fileId = String(req.query.id || '');
  if (!/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    return res.status(400).json({ error: 'Invalid file id' });
  }

  const driveUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
  try {
    const headers = { 'User-Agent': 'Mozilla/5.0 AccessoryGuide/1.0' };
    if (req.headers.range) headers.Range = req.headers.range;
    const upstream = await axios.get(driveUrl, {
      responseType: 'stream',
      timeout: 90000,
      maxRedirects: 5,
      validateStatus: status => status >= 200 && status < 400,
      headers
    });

    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
    if (upstream.headers['content-range']) res.setHeader('Content-Range', upstream.headers['content-range']);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    upstream.data.pipe(res);
    upstream.data.on('error', err => {
      console.error('Video proxy stream failed:', err.message);
      if (!res.headersSent) res.sendStatus(502);
      else res.destroy(err);
    });
  } catch (err) {
    console.error('Video proxy failed:', err.message);
    if (!res.headersSent) res.status(err.response?.status || 502).json({ error: 'Video proxy failed' });
  }
});

app.get('/api/products/:sku', async (req, res) => {
  try {
    const product = await productService.getProductBySku(req.params.sku);
    if (!product) return res.status(404).json({ error: 'Not found' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/products/refresh', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const products = await productService.refresh();
    res.json({ success: true, count: products.length, cache: productService.getCacheMeta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/products/:sku', authMiddleware, requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ error: 'Database not available' });
    const sku = decodeURIComponent(req.params.sku);
    const { name, category, mainImageUrl, descriptions, videos } = req.body;
    const { rows } = await pool.query('SELECT data FROM products WHERE sku = $1', [sku]);
    if (rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    const product = rows[0].data;
    if (name !== undefined) product.name = name;
    if (category !== undefined) product.category = category;
    if (mainImageUrl !== undefined) {
      product.mainImage = mainImageUrl ? { ...product.mainImage, url: mainImageUrl, downloadUrl: product.mainImage?.downloadUrl || mainImageUrl, label: '主产品图' } : null;
    }
    if (descriptions !== undefined) {
      product.descriptions = { ...product.descriptions, ...descriptions };
    }
    if (videos !== undefined) {
      product.videos = videos;
    }
    await pool.query('UPDATE products SET data = $1, synced_at = NOW() WHERE sku = $2', [JSON.stringify(product), sku]);
    productService.clearCache();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cron/products/sync', async (req, res) => {
  const expectedSecret = process.env.CRON_SECRET || '';
  const providedSecret = req.headers.authorization?.replace('Bearer ', '') || req.query.secret || req.headers['x-cron-secret'];
  if (expectedSecret && providedSecret !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const products = await productService.refresh();
    res.json({ success: true, count: products.length, cache: productService.getCacheMeta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/product-sync', async (req, res) => {
  const expectedSecret = process.env.CRON_SECRET || '';
  const providedSecret = req.headers.authorization?.replace('Bearer ', '') || req.query.secret || req.headers['x-cron-secret'];
  if (expectedSecret && providedSecret !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const products = await productService.refresh();
    res.json({ success: true, count: products.length, cache: productService.getCacheMeta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stats
app.get('/api/admin/stats', authMiddleware, async (req, res) => {
  try {
    const db = await readDB();
    let productCount = 0;
    let userCount = 0;
    if (supabaseAdmin) {
      try {
        const { data } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        userCount = (data.users || []).length;
      } catch {}
    }
    if (pool) {
      try {
        const { rows } = await pool.query('SELECT count FROM products_meta WHERE id = $1', ['syncMeta']);
        if (rows.length > 0) productCount = rows[0].count;
      } catch {}
    }
    const today = new Date().toISOString().slice(0, 10);
    const siteVisits = db.siteVisits || { total: 0, byDate: {} };
    res.json({
      userCount,
      totalVisits: Number(siteVisits.total || 0),
      todayVisits: Number(siteVisits.byDate?.[today] || 0),
      productCount
    });
  } catch (err) {
    res.json({ userCount: 0, totalVisits: 0, todayVisits: 0, productCount: 0 });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
async function startServer() {
  await connectDB();
  await initDB();
  try {
    await syncProductsToDB();
    await syncAmazonToDB();
    await syncFilmToDB();
    await syncGoogleToDB();
  } catch (err) {
    console.error('[startup-sync] Initial sync failed:', err.message);
  }
  await startDataSyncScheduler();
  httpServer = app.listen(PORT, () => console.log(`AccessoryGuide running on http://localhost:${PORT}`));
}

if (process.env.VERCEL) {
  initDB().catch(err => console.error('Initialization failed:', err.message));
  module.exports = app;
} else {
  startServer();
}
