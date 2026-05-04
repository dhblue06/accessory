# TEMCO Accessory Guide - 完整开发文档

## 项目概述

TEMCO Accessory Guide 是一个配件兼容性查询系统，支持 iPad、Apple Watch 配件兼容性查询，以及 Amazon 热销榜单展示。

### 主要功能

- **iPad 兼容性查询** - 按系列分组展示保护壳/钢化膜通用情况
- **Apple Watch 配件查询** - Watch 配件兼容性查询
- **手机膜通用查询** - 全胶防静电膜 / 2.5D通用膜 / 防窥膜三大类
- **Amazon 榜单** - 从 Google Sheets 读取 Amazon 热门产品排行榜
- **产品素材库** - 从 Google Sheet 读取产品数据，支持多语言图片分组、视频嵌入、ZIP批量下载
- **多语言支持** - 西班牙语、英语、中文
- **后台管理系统** - 数据管理、用户管理、系统设置

---

## 技术架构

### 技术栈

- **后端**: Node.js + Express
- **数据库**: MongoDB Atlas（主力）+ JSON 文件（本地降级）
- **认证**: JWT Token（admin）
- **前端**: 原生 HTML/CSS/JS 单页应用（SPA）
- **产品数据**: Google Sheets（gviz API）+ node-cache 缓存
- **部署**: 支持 Railway

### 目录结构

```
accessory-guide/
├── server.js              # 后端服务器 (Express)
├── package.json           # 依赖配置
├── services/
│   └── products.js        # 产品素材库服务（Google Sheet 数据拉取/解析/缓存）
├── public/
│   └── index.html         # 前台 + 后台单页应用（全部前端代码）
├── data/
│   ├── db.json            # 主数据库（iPad/Watch/膜数据/设置/翻译）
│   └── users.json         # 用户数据
└── film_data.json         # 膜数据源文件（可选）
```

---

## 快速启动

### 本地开发

```bash
# 克隆仓库
git clone https://github.com/dhblue06/accessory.git
cd accessory-guide

# 安装依赖
npm install

# 启动服务器
node server.js

# 访问
# 前台: http://localhost:3000
# 后台: http://localhost:3000/#admin
```

### 默认账号

- **用户名**: `admin`
- **密码**: `admin123`

⚠️ **重要**: 上线前务必修改密码！

---

## API 文档

### 公开 API

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/ipad` | 获取 iPad 数据（支持 `?q=` 搜索和 `?lang=` 语言参数）|
| GET | `/api/watch` | 获取 Watch 数据（支持 `?q=` 搜索和 `?lang=` 语言参数）|
| GET | `/api/film` | 获取膜数据（支持 `?q=` 搜索和 `?brand=` 品牌参数）|
| GET | `/api/settings` | 获取网站设置 |
| GET | `/api/translations?lang=es` | 获取翻译文本 |
| GET | `/api/amazon-categories` | 获取 Amazon 品类翻译 |
| POST | `/api/auth/login` | 登录 |
| GET | `/api/auth/me` | 获取当前用户信息 |
| GET | `/api/products` | 产品素材库列表（支持 `?q=` 搜索和 `?category=` 分类过滤）|
| GET | `/api/products/categories` | 产品素材库分类列表 |
| GET | `/api/products/:sku` | 产品素材库详情（含图片组、视频、文案）|

### 管理后台 API（需认证）

| 方法 | 路径 | 描述 |
|------|------|------|
| GET/POST/PUT/DELETE | `/api/admin/ipad` | iPad 型号 CRUD |
| GET/POST/PUT/DELETE | `/api/admin/watch` | Watch 型号 CRUD |
| POST/PUT/DELETE | `/api/admin/film/fg/:filmName` | 膜数据管理 |
| PUT | `/api/admin/settings` | 更新网站设置 |
| GET/PUT | `/api/admin/translations` | 翻译管理 |
| GET/PUT | `/api/admin/amazon-categories` | Amazon 品类翻译管理 |
| GET/POST/DELETE | `/api/admin/users` | 用户管理 |
| GET | `/api/admin/stats` | 数据统计 |
| POST | `/api/admin/logo` | 上传 Logo |

### 认证方式

```javascript
// 请求头添加 JWT Token
Authorization: Bearer <token>
```

---

## 数据库结构

### db.json

```json
{
  "ipad": [
    {
      "id": 1,
      "group": { "zh": "iPad Pro 13\"", "en": "...", "es": "..." },
      "name": { "zh": "Pro 13 (M4 2024)", "en": "...", "es": "..." },
      "years": { "zh": "M4/M5", "en": "...", "es": "..." },
      "caseComp": { "zh": "⚠️ 专用", "en": "...", "es": "..." },
      "filmComp": { "zh": "💰 13寸组A", "en": "...", "es": "..." },
      "note": { "zh": "全面屏/Face ID", "en": "...", "es": "..." },
      "specialWarning": true,
      "order": 1
    }
  ],
  "watch": [...],
  "film": {
    "fullGlue": { "膜型号": [{ "brand": "品牌", "models": "适用型号" }] },
    "twoPointFiveD": [...],
    "privacy": [...]
  },
  "settings": {
    "siteName": "TEMCO",
    "version": "v1.0",
    "note": ""
  },
  "translations": {
    "zh": { "nav_film": "钢化膜通用", ... },
    "en": { ... },
    "es": { ... }
  },
  "amazonCategories": {
    "手机": { "es": "Teléfono", "en": "Phone", "zh": "手机" },
    ...
  }
}
```

### users.json

```json
[
  { "id": 1, "username": "admin", "password": "加密密码", "role": "admin", "createdAt": "..." }
]
```

---

## 前端架构

### 主要模块

#### 1. 页面路由
- `#film` - 钢化膜页面
- `#ipad` - iPad 页面
- `#watch` - Watch 页面
- `#amazon` - Amazon 榜单页面
- `#admin` - 后台管理

#### 2. 状态变量

```javascript
let currentLang = 'es';        // 当前语言
let currentTheme = 'light';    // 当前主题
let token = '';                // JWT Token
let currentPage = 'film';      // 当前页面
let amazonAllData = [];       // Amazon 全部数据
let amazonCategoryTrans = {};  // Amazon 品类翻译
let filmSelectedBrand = '';    // 选中的品牌（用于高亮）
let allFilmBrands = [];       // 所有品牌列表
```

#### 3. 核心函数

**翻译系统**
- `t(key)` - 获取翻译文本
- `setLanguage(lang)` - 切换语言
- `loadTranslations()` - 加载翻译数据
- `translateCategory(raw)` - 翻译 Amazon 品类

**主题系统**
- `toggleTheme()` - 切换主题
- `applyTheme()` - 应用主题到页面

**数据加载**
- `loadFilm()` - 加载膜数据
- `loadiPad()` - 加载 iPad 数据
- `loadWatch()` - 加载 Watch 数据
- `fetchAmazonData()` - 获取 Amazon 榜单数据
- `loadProductsPage()` - 加载产品素材库列表
- `openProductDetail(sku)` - 打开产品素材库详情

---

## 产品素材库

### 数据来源

从 Google Sheet 读取，通过 gviz API 拉取 JSON 数据：

```
https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:json&sheet=Sheet1
```

### Sheet 列定义

```
A: 产品名    B: SKU    C: 分类
D: 主产品图  E: 点击下载
F: 产品图2(西)  G: 点击下载  H: 产品图2(中)  I: 点击下载
J: 产品图3(西)  K: 点击下载  L: 产品图3(中)  M: 点击下载
N: 产品图4(西)  O: 点击下载  P: 产品图4(中)  Q: 点击下载
R: 产品介绍(西)  S: 产品介绍(中)
T: 广告视频  U: 使用说明视频
```

### 图片 URL 读取策略

- 优先读取 D/F/H/J/L/N/P 列的 `=IMAGE(url)` 公式或纯文本 URL
- 读不到时降级到相邻"点击下载"列的 HYPERLINK 链接
- Drive 图片自动转换为 `lh3.googleusercontent.com` 直链展示
- 5 分钟缓存，再次请求不重复拉取 Google Sheet

### 视频处理

- Drive 链接自动提取文件 ID，生成 `drive.google.com/file/d/{id}/preview` 嵌入 iframe
- 视频文件需在 Drive 中设置为"知道链接的人都能查看"

### 前端功能

- **列表页**：卡片网格展示，支持 SKU/名称搜索 + 分类过滤
- **详情页**：主图单独展示、图片分组（产品海报/颜色展示图/使用场景图）、视频嵌入播放、双语文案并列
- **下载**：单张图片直接下载、整组图片打包 ZIP 下载（JSZip）、文案一键复制

---

## 多语言实现

### 语言切换

默认语言顺序：ES → EN → 中文

```javascript
// 语言变量
let currentLang = localStorage.getItem('ag_lang') || 'es';

// 切换语言
function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('ag_lang', lang);
  loadTranslations().then(() => {
    applyTranslations();
    // 重新渲染当前页面...
  });
}
```

### 品类翻译

Amazon 品类使用独立翻译系统：

```javascript
const CAT_MAP = {
  '手机': { es: 'Teléfono', en: 'Phone', zh: '手机' },
  '手机壳': { es: 'Funda', en: 'Case', zh: '手机壳' },
  // ...
};

function translateCategory(raw) {
  const normalized = raw.replace(/[^\u4e00-\u9fa5]/g, '');
  // 优先使用 API 翻译，否则使用硬编码映射
  const apiTrans = amazonCategoryTrans[normalized]?.[currentLang];
  if (apiTrans) return apiTrans;
  if (CAT_MAP[normalized]) return CAT_MAP[normalized][currentLang] || raw;
  return raw;
}
```

---

## 主题系统

### 主题变量

```css
/* 亮色主题 */
[data-theme="light"] {
  --bg: #ffffff;
  --surface: #f7f8fc;
  --text: #1a1a2e;
  --accent: #0066cc;
  --border: #e5e7eb;
}

/* 暗色主题 */
[data-theme="dark"] {
  --bg: #0f0f14;
  --surface: #1a1a24;
  --text: #e8e8ed;
  --accent: #3b82f6;
  --border: #2d2d3a;
}
```

### 默认主题

- **默认显示**: 亮色模式
- **主题切换**: 顶部导航栏图标按钮
- **持久化**: localStorage 保存用户偏好

---

## Amazon 榜单功能

### 数据来源

从 Google Sheets 读取数据：

```
https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:json&sheet=latest
```

### 数据格式

```javascript
{
  category: "❤️ 手机",    // 原始品类（含 emoji）
  categoryRaw: "❤️ 手机",
  type: "WISHED",         // WISHED / BESTSELLER
  rank: 1,
  title: "产品标题",
  price: "€199,00",
  rating: "4,5 de 5 estrellas",
  reviews: "1.234",
  imageUrl: "https://...",
  productUrl: "https://amazon.es/..."
}
```

### 品类归一化

Google Sheet 品类格式：`❤️ 手机`、`📱 手机壳`、`🔥 热销`

```javascript
function normalizeCategory(raw) {
  return raw.replace(/[^\u4e00-\u9fa5]/g, '');
}
// "❤️ 手机" → "手机"
```

### 榜单模式

- **Bestseller (🔥)** - 热销榜单
- **Most Wanted (❤️)** - 心愿榜单

---

## 部署指南

### Railway 部署（推荐）

Railway 部署简单，但需要注意：

⚠️ **重要**: Railway 文件系统是临时的！

**问题**: 每次重新部署时，文件系统会重置，`data/db.json` 中的数据会丢失。

**解决方案**:

1. **方案一**: 重新部署后手动恢复数据
2. **方案二**: 将数据存储在环境变量或外部数据库
3. **方案三**: Railway Persistence Storage（付费功能）

```bash
# Railway 部署命令
railway login
railway init
railway up
```

### PM2 部署

```bash
# 安装 PM2
npm install -g pm2

# 启动
pm2 start server.js --name accessory-guide

# 保存进程列表
pm2 save

# 设置开机自启
pm2 startup
```

### Nginx 反向代理

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 环境变量

| 变量 | 默认值 | 描述 |
|------|--------|------|
| `PORT` | 3000 | 服务器端口 |
| `JWT_SECRET` | accessory-guide-secret-2024 | JWT 密钥（生产环境必须修改！）|
| `MONGO_URI` | mongodb+srv://... | MongoDB 连接串 |
| `PRODUCT_SHEET_ID` | 10C954V-... | 产品素材库 Google Sheet ID |
| `PRODUCT_SHEET_NAME` | Sheet1 | 产品素材库 Sheet 名称 |

---

## 开发指南

### 添加新页面

1. 在 `index.html` 中添加页面容器：
```html
<div id="new-page" class="page" style="display:none">
  <!-- 页面内容 -->
</div>
```

2. 添加导航按钮：
```html
<a class="nav-tab" data-page="new" onclick="switchPage('new')">新页面</a>
```

3. 在 `switchPage` 函数中添加路由处理：
```javascript
function switchPage(page) {
  // ...
  if (page === 'new') {
    loadNewPageData();
  }
}
```

### 添加新的翻译

1. 在 `server.js` 的 `DEFAULT_TRANSLATIONS` 中添加：
```javascript
const DEFAULT_TRANSLATIONS = {
  zh: { new_key: '中文文本', ... },
  en: { new_key: 'English Text', ... },
  es: { new_key: 'Texto en Español', ... }
};
```

2. 在前端使用：
```javascript
t('new_key')
```

### 添加 Amazon 品类翻译

1. 在 `server.js` 数据库中更新：
```javascript
db.amazonCategories = {
  "手机": { es: "Teléfono", en: "Phone", zh: "手机" },
  // ...
};
```

2. 或通过后台管理界面保存

---

## 常见问题

### Q: Amazon 品类翻译不生效？

1. 检查 `translateCategory` 函数逻辑
2. 确认 `currentLang` 变量正确
3. 检查 `CAT_MAP` 是否包含目标品类
4. 确认 `amazonCategoryTrans` API 数据已加载

### Q: Railway 重新部署后数据丢失？

Railway 文件系统是临时的，请参考上面的"部署指南"章节解决。

### Q: 如何修改默认语言/主题？

代码中已设置为默认值：
- 默认语言: `es`（西班牙语）
- 默认主题: `light`（亮色）

### Q: 后台管理入口在哪里？

访问 `http://yourdomain.com/#admin` 进入后台登录页面。

---

## 更新日志

### v1.2.0
- 产品素材库：从 Google Sheet 读取产品数据
- 图片分组管理（主图/海报/颜色展示图/场景图）
- 视频嵌入播放（Google Drive）
- ZIP 批量下载（JSZip）
- 双语文案一键复制
- MongoDB Atlas 数据持久化

### v1.1.0
- 多页面 Hero UI 升级（Film/iPad/Watch/Amazon）
- 移动端 Hero 装饰图优化
- 暗色模式配色修复

### v1.0.0
- 初始版本
- iPad/Watch/膜数据管理
- Amazon 榜单功能
- 多语言支持（ES/EN/ZH）
- 亮色/暗色主题

---

## 许可证

MIT License
