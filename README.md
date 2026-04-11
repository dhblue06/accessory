# 配件指南 — AccessoryGuide 系统

## 系统功能

### 前台查询
- **iPad 兼容性** — 按系列分组展示保护壳/钢化膜通用情况
- **Apple Watch** — Watch 配件兼容性查询
- **手机膜通用** — 全胶防静电膜 / 2.5D通用膜 / 防窥膜三大类查询

### 后台管理（访问 /#admin）
- 数据概览仪表盘
- iPad / Watch 型号的增删改查
- 膜数据组管理
- 用户账号管理
- 系统设置（站名、版本号）

## 快速启动

```bash
# 安装依赖
npm install

# 启动服务器
node server.js

# 访问
# 前台: http://localhost:3000
# 后台: http://localhost:3000/#admin
```

## 默认账号
- 用户名: `admin`
- 密码: `admin123`
⚠️ 请上线前务必修改密码（在后台用户管理中删除并重建账号）

## 目录结构
```
accessory-guide/
├── server.js          # 后端服务器 (Express)
├── public/
│   └── index.html     # 前台 + 后台单页应用
├── data/
│   ├── db.json        # 主数据库 (JSON文件)
│   └── users.json     # 用户数据
└── package.json
```

## 部署建议

### 使用 PM2 保持后台运行
```bash
npm install -g pm2
pm2 start server.js --name accessory-guide
pm2 save
```

### Nginx 反向代理 (可选)
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
    }
}
```

### 环境变量
```
PORT=3000           # 端口
JWT_SECRET=xxx      # 自定义 JWT 密钥（必须修改！）
```

## 技术栈
- **后端**: Node.js + Express
- **数据库**: JSON 文件（轻量，无需安装数据库）
- **认证**: JWT Token
- **前端**: 原生 HTML/CSS/JS 单页应用
