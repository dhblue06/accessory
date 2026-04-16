'use strict';
const express = require('./node_modules/express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('./node_modules/bcryptjs');
const jwt = require('./node_modules/jsonwebtoken');
const XLSX = require('xlsx');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

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
const JWT_SECRET = process.env.JWT_SECRET || 'accessory-guide-secret-2024';
const DB_FILE = path.join(__dirname, 'data', 'db.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const XLSX_FILE = path.join(__dirname, 'data.xlsx');

// Ensure data dir exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

// --- DB helpers ---
function readDB() {
  if (!fs.existsSync(DB_FILE)) return { ipad: [], watch: [], film: { fullGlue: {}, twoPointFiveD: [], privacy: [] }, settings: { siteName: 'TEMCO ACCESORIOS', version: 'v1.0' }, translations: {} };
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
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
    nav_film: 'Vidrio Templado',
    nav_ipad: 'iPad',
    nav_watch: 'Watch',
    title_film: 'Búsqueda Universal de Vidrio Templado',
    title_ipad: 'Compatibilidad de Accesorios iPad',
    title_watch: 'Compatibilidad de Accesorios Apple Watch',
    subtitle_film: 'Guía de Compatibilidad de Vidrio Adhesivo Completo',
    subtitle_ipad: 'Consultar compatibilidad de fundas y cristales para iPad',
    subtitle_watch: 'Consultar compatibilidad de fundas y correas para Apple Watch',
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
function readUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}
function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

// Initialize DB from film_data.json if empty
function initDB() {
  const db = readDB();
  const filmSrc = path.join(__dirname, '..', 'film_data.json');
  if ((!db.film || !db.film.fullGlue || Object.keys(db.film.fullGlue).length === 0) && fs.existsSync(filmSrc)) {
    const raw = JSON.parse(fs.readFileSync(filmSrc, 'utf8'));
    db.film = raw;
    writeDB(db);
    console.log('Initialized film data from film_data.json');
  }
  // Default iPad data - migrate to multi-language if needed
  if (!db.ipad || db.ipad.length === 0) {
    db.ipad = getDefaultiPadData();
    writeDB(db);
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
      writeDB(db);
      console.log('Migrated iPad data to multi-language format');
    }
  }
  // Default admin user
  const users = readUsers();
  if (users.length === 0) {
    users.push({ id: 1, username: 'admin', password: bcrypt.hashSync('admin123', 10), role: 'admin', createdAt: new Date().toISOString() });
    writeUsers(users);
    console.log('Created default admin: admin / admin123');
  }
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

// Auth middleware
function authMiddleware(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

// ============ AUTH ============
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const users = readUsers();
  const user = users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
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

app.get('/api/ipad', (req, res) => {
  const db = readDB();
  const lang = req.query.lang || 'zh';
  const q = (req.query.q || '').toLowerCase();
  let items = db.ipad || [];
  
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

app.get('/api/watch', (req, res) => {
  const db = readDB();
  const lang = req.query.lang || 'zh';
  const q = (req.query.q || '').toLowerCase();
  let items = db.watch || [];
  
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

app.get('/api/film', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const brand = req.query.brand || '';
  
  // Read from xlsx
  const filmData = readFilmFromXlsx();
  
  let results = {};
  for (const [k, v] of Object.entries(filmData)) {
    const entries = v.filter(e => {
      const brandMatch = !brand || e.brand === brand;
      const qMatch = !q || e.models.toLowerCase().includes(q) || k.toLowerCase().includes(q) || e.brand.toLowerCase().includes(q);
      return brandMatch && qMatch;
    });
    if (entries.length) results[k] = entries;
  }
  res.json(results);
});

app.get('/api/settings', (req, res) => {
  const db = readDB();
  res.json(db.settings || { siteName: 'TEMCO ACCESORIOS', version: 'v1.0' });
});

// Translations API
app.get('/api/translations', (req, res) => {
  const db = readDB();
  const lang = req.query.lang || 'zh';
  const translations = db.translations || {};
  res.json({
    lang,
    texts: translations[lang] || DEFAULT_TRANSLATIONS[lang] || DEFAULT_TRANSLATIONS.zh
  });
});

// ============ ADMIN APIs ============
// iPad CRUD
app.get('/api/admin/ipad', authMiddleware, (req, res) => {
  const db = readDB();
  // Migrate legacy data to multi-language format
  const items = (db.ipad || []).map(migrateToMultiLang);
  res.json(items);
});

app.post('/api/admin/ipad', authMiddleware, (req, res) => {
  const db = readDB();
  const item = { ...req.body, id: Date.now(), createdAt: new Date().toISOString() };
  db.ipad = db.ipad || [];
  db.ipad.push(item);
  writeDB(db);
  res.json(item);
});

app.put('/api/admin/ipad/:id', authMiddleware, (req, res) => {
  const db = readDB();
  const idx = db.ipad.findIndex(i => String(i.id) === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  db.ipad[idx] = { ...db.ipad[idx], ...req.body };
  writeDB(db);
  res.json(db.ipad[idx]);
});

app.delete('/api/admin/ipad/:id', authMiddleware, (req, res) => {
  const db = readDB();
  db.ipad = db.ipad.filter(i => String(i.id) !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// Watch CRUD
app.get('/api/admin/watch', authMiddleware, (req, res) => {
  const db = readDB();
  // Migrate legacy data to multi-language format
  const items = (db.watch || []).map(migrateToMultiLang);
  res.json(items);
});

app.post('/api/admin/watch', authMiddleware, (req, res) => {
  const db = readDB();
  const item = { ...req.body, id: Date.now(), createdAt: new Date().toISOString() };
  db.watch = db.watch || [];
  db.watch.push(item);
  writeDB(db);
  res.json(item);
});

app.put('/api/admin/watch/:id', authMiddleware, (req, res) => {
  const db = readDB();
  const idx = db.watch.findIndex(i => String(i.id) === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  db.watch[idx] = { ...db.watch[idx], ...req.body };
  writeDB(db);
  res.json(db.watch[idx]);
});

app.delete('/api/admin/watch/:id', authMiddleware, (req, res) => {
  const db = readDB();
  db.watch = db.watch.filter(i => String(i.id) !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// Film groups CRUD (full-glue)
app.post('/api/admin/film/fg', authMiddleware, (req, res) => {
  const db = readDB();
  const { filmName, brand, models } = req.body;
  if (!db.film) db.film = { fullGlue: {}, twoPointFiveD: [], privacy: [] };
  if (!db.film.fullGlue[filmName]) db.film.fullGlue[filmName] = [];
  db.film.fullGlue[filmName].push({ brand, models });
  writeDB(db);
  res.json({ ok: true });
});

app.put('/api/admin/film/fg/:filmName', authMiddleware, (req, res) => {
  const db = readDB();
  const { entries } = req.body;
  db.film.fullGlue[req.params.filmName] = entries;
  writeDB(db);
  res.json({ ok: true });
});

app.delete('/api/admin/film/fg/:filmName', authMiddleware, (req, res) => {
  const db = readDB();
  delete db.film.fullGlue[decodeURIComponent(req.params.filmName)];
  writeDB(db);
  res.json({ ok: true });
});

// Logo upload
app.post('/api/admin/logo', authMiddleware, upload.single('logo'), (req, res) => {
  res.json({ ok: true, file: req.file });
});

// Settings
app.put('/api/admin/settings', authMiddleware, (req, res) => {
  const db = readDB();
  db.settings = { ...db.settings, ...req.body };
  writeDB(db);
  res.json(db.settings);
});

// Translations admin
app.get('/api/admin/translations', authMiddleware, (req, res) => {
  const db = readDB();
  const translations = db.translations || {};
  res.json({
    zh: translations.zh || DEFAULT_TRANSLATIONS.zh,
    en: translations.en || DEFAULT_TRANSLATIONS.en,
    es: translations.es || DEFAULT_TRANSLATIONS.es
  });
});

app.put('/api/admin/translations', authMiddleware, (req, res) => {
  const db = readDB();
  const { zh, en, es } = req.body;
  if (!db.translations) db.translations = {};
  if (zh) db.translations.zh = { ...DEFAULT_TRANSLATIONS.zh, ...zh };
  if (en) db.translations.en = { ...DEFAULT_TRANSLATIONS.en, ...en };
  if (es) db.translations.es = { ...DEFAULT_TRANSLATIONS.es, ...es };
  writeDB(db);
  res.json({ ok: true });
});

// Amazon category translations
app.get('/api/amazon-categories', (req, res) => {
  const db = readDB();
  res.json(db.amazonCategories || {});
});

app.put('/api/admin/amazon-categories', authMiddleware, (req, res) => {
  const db = readDB();
  db.amazonCategories = req.body;
  writeDB(db);
  res.json({ ok: true });
});

// Users
app.get('/api/admin/users', authMiddleware, (req, res) => {
  const users = readUsers().map(u => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt }));
  res.json(users);
});

app.post('/api/admin/users', authMiddleware, (req, res) => {
  const { username, password, role } = req.body;
  const users = readUsers();
  if (users.find(u => u.username === username)) return res.status(400).json({ error: '用户名已存在' });
  const user = { id: Date.now(), username, password: bcrypt.hashSync(password, 10), role: role || 'editor', createdAt: new Date().toISOString() };
  users.push(user);
  writeUsers(users);
  res.json({ id: user.id, username: user.username, role: user.role });
});

app.delete('/api/admin/users/:id', authMiddleware, (req, res) => {
  let users = readUsers();
  users = users.filter(u => String(u.id) !== req.params.id);
  writeUsers(users);
  res.json({ ok: true });
});

// Stats
app.get('/api/admin/stats', authMiddleware, (req, res) => {
  const db = readDB();
  const filmData = readFilmFromXlsx();
  res.json({
    ipadCount: (db.ipad || []).length,
    watchCount: (db.watch || []).length,
    fgCount: Object.keys(filmData).length,
    tdCount: 0,
    privacyCount: 0,
    userCount: readUsers().length
  });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDB();
app.listen(PORT, () => console.log(`AccessoryGuide running on http://localhost:${PORT}`));
