# TEMCO Accessory Guide

配件兼容性查询系统，支持 iPad、Apple Watch 膜/壳兼容性查询、钢化膜通用型号搜索、Amazon 热销榜单及产品素材库。

## 主要功能

- **iPad 兼容性查询** — 按系列展示保护壳/钢化膜通用情况
- **Apple Watch 配件查询** — Watch 壳/膜/表带兼容性
- **钢化膜通用查询** — 全胶防静电膜 / 2.5D通用膜 / 防窥膜
- **Amazon 榜单** — Google Sheet 数据缓存至数据库，前端快速读取
- **产品素材库** — Google Sheet 产品数据同步，多语言图片/视频/文案
- **多语言支持** — 西班牙语（默认）、英语、中文
- **管理员后台** — iPad/Watch/膜数据管理、用户管理、系统设置
- **会员中心** — 注册/登录、编辑姓名/电话/商店、修改密码、上传头像

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js + Express |
| 数据库 | Supabase PostgreSQL（`app_data` JSONB + `profiles` 表）|
| 认证 | Supabase Auth（邮箱+密码注册/登录）|
| 存储 | Supabase Storage（头像上传）|
| 前端 | 原生 HTML/CSS/JS 单页应用 |
| 数据源 | Google Sheets → 定时同步到 Supabase |
| 部署 | Vercel（Serverless）|

## 快速启动

```bash
git clone https://github.com/dhblue06/accessory.git
cd accessory
npm install
cp .env.example .env  # 填写配置
node server.js
```

访问 `http://localhost:3000`

## 环境变量

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | Supabase PostgreSQL 连接串 |
| `SUPABASE_URL` | Supabase 项目 URL |
| `SUPABASE_ANON_KEY` | Supabase 公开 API 密钥 |
| `SUPABASE_SERVICE_KEY` | Supabase 服务角色密钥（管理操作用）|
| `ADMIN_EMAILS` | 管理员邮箱（逗号分隔）|
| `PRODUCT_SHEET_ID` | 产品素材库 Google Sheet ID |
| `AMAZON_SHEET_ID` | Amazon 榜单 Google Sheet ID |

## 数据库结构

### app_data 表
单一 JSONB 表存储应用配置数据：
- `key = 'main'` — iPad/Watch/膜数据/设置/翻译
- `key = 'amazon'` — Amazon 榜单缓存
- `key = 'film'` — 膜数据缓存

### profiles 表
用户档案（与 Supabase Auth 关联）：
| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | 关联 auth.users.id |
| `full_name` | text | 姓名 |
| `phone` | text | 电话 |
| `store` | text | 商店/公司 |
| `avatar_url` | text | 头像 URL |
| `role` | text | admin / member |
| `updated_at` | timestamptz | 更新时间 |

### products / products_meta 表
产品素材库缓存，从 Google Sheet 同步。

## API

### 公开 API
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/ipad?q=&lang=` | iPad 兼容性数据 |
| GET | `/api/watch?q=&lang=` | Watch 兼容性数据 |
| GET | `/api/film?q=&brand=` | 膜数据 |
| GET | `/api/amazon` | Amazon 榜单（从缓存读取） |
| GET | `/api/products?q=&category=` | 产品素材库列表 |
| GET | `/api/settings` | 网站设置 |
| GET | `/api/translations?lang=` | 多语言翻译 |

### 认证 API
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/auth/status` | Supabase 配置状态 |
| GET | `/api/auth/me` | 当前用户信息 |

### 会员 API（需 Bearer Token）
| 方法 | 路径 | 说明 |
|---|---|---|
| PUT | `/api/member/update` | 更新姓名/电话/商店 |
| PUT | `/api/member/change-password` | 修改密码 |
| PUT | `/api/member/avatar` | 上传头像 |

### 管理后台 API（需 admin 角色）
| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST/PUT/DELETE | `/api/admin/ipad` | iPad 型号 CRUD |
| GET/POST/PUT/DELETE | `/api/admin/watch` | Watch 型号 CRUD |
| POST/PUT/DELETE | `/api/admin/film/fg/:filmName` | 膜数据管理 |
| GET/POST/PUT/DELETE | `/api/admin/users` | 用户管理（含编辑角色）|
| GET/POST | `/api/admin/sync/amazon` | 手动同步 Amazon 数据 |
| GET/POST | `/api/admin/sync/film` | 手动同步膜数据 |
| GET/POST | `/api/admin/sync/all` | 同步全部数据 |
| PUT | `/api/admin/settings` | 系统设置 |

## 数据同步

Amazon 榜单和产品素材库数据从 Google Sheet 获取，支持：
- **启动时自动同步**
- **每小时定时同步**（可配置 `DATA_SYNC_INTERVAL_MS`）
- **后台手动同步**（管理面板 → 快速操作）

## 部署

### Vercel

```bash
npx vercel --prod
```

Vercel 环境变量需配置 `DATABASE_URL`、`SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_KEY`。

## 更新日志

### v2.0.0
- MongoDB → Supabase PostgreSQL
- Clerk → Logto → Supabase Auth
- 会员中心（可编辑资料、头像上传、密码修改）
- Google Sheet 数据缓存到数据库
- 磨砂透明弹窗登录/注册/会员中心
- 手机端三横杆菜单
- 后台用户编辑（姓名/电话/商店/角色）
- 多语言全覆盖
- Vercel Serverless 部署
