# 校园设备管理平台（School Equipment Manager）

面向学校设备中心的管理系统，三个核心模块：

| 模块 | 功能 |
| --- | --- |
| 设备管理 | 设备台账（名称 / 分类 / 总数 / 在用 / 借出 / 剩余），**CSV 批量导入**（拖拽上传、列名自动识别、预览与去重策略），手动增删改查，库存告急提示 |
| 学生借用登记 | 学生提交借用申请（姓名 / 班级 / 设备 / 数量 / 用途）→ 负责人**批准 / 拒绝** → **登记归还**；审批通过自动扣减库存、归还自动恢复 |
| 3D 打印服务 | 学生申请打印（需求描述 / 材料 / 数量 / 联系方式），负责人流转工单：**待接单 → 打印中 → 待交付 → 已交付**，记录学生信息与各节点时间 |
| 管理员登录 | 仅限管理员使用，密码以 PBKDF2-SHA256 哈希校验，登录后签发 7 天有效期的 HttpOnly 会话 |

技术栈：Next.js 16（App Router）· TypeScript · Tailwind CSS v4 · lucide-react

---

## 一、本地运行

```bash
npm install
npm run dev
# 打开 http://localhost:3000
```

> 本地开发的数据层为**本地 JSON 文件存储**（`.data/db.json`），初始为空台账，
> 通过「添加设备」或「导入 CSV」即可建立数据。
> 部署到 Vercel 并创建 Postgres 数据库后，会自动切换为数据库存储（见第三节）。

常用脚本：

```bash
npm run dev      # 开发
npm run build    # 构建检查
npm start        # 生产模式
```

---

## 管理员登录

平台仅限管理员使用，未登录访问任何页面或 API 都会被拦截到登录页（`/login`）。

- 密码以 **PBKDF2-SHA256 哈希**形式存于 `lib/auth.ts`（`PASSWORD_HASH`），明文不出现在代码中；
- 校验通过后签发 HMAC 签名的 HttpOnly Cookie 会话，有效期 7 天；
- 更换密码：用以下命令重新计算哈希，替换 `lib/auth.ts` 中的 `PASSWORD_HASH` 即可：
  ```bash
  node -e 'console.log(require("crypto").pbkdf2Sync("新密码", "2046cee3a35d8ca94e526ccd82ac0a46", 100000, 32, "sha256").toString("hex"))'
  ```

---

## 二、部署到 Vercel

1. 把本项目推到 GitHub（本项目已初始化 git，注意 `.data/` 已被 gitignore）：
   ```bash
   git add . && git commit -m "init: 校园设备管理系统"
   ```
2. 打开 [vercel.com/new](https://vercel.com/new)，导入仓库，Framework 选 **Next.js**，其余默认。
3. 点击 Deploy。构建完成后即可访问线上地址。

> 注意：Vercel 的无服务器环境**文件系统不可持久化**，本地数据每次部署会重置，
> 因此正式使用前必须完成第三步（接入数据库）。

---

## 三、接入 Vercel 数据库（Postgres）

代码已内置 `@vercel/postgres` 数据层，并且**首次请求会自动建表**，不需要手动执行 SQL。
只需两步：

1. 在 Vercel 项目 → **Storage** 中创建 **Postgres** 数据库（Neon 托管，免费档即可），
   创建时选择关联到本项目，Vercel 会自动注入 `POSTGRES_URL` 等环境变量；
2. 重新部署一次（Deployments → Redeploy，或推送一个新 commit）。

完成后的行为：

- 线上（存在 `POSTGRES_URL`）→ 自动使用 Postgres，数据持久保存；
- 本地开发（无 `POSTGRES_URL`）→ 自动回退到本地 JSON 文件（`.data/db.json`），互不影响；
- 表结构参考 `db/init.sql`（无需手动执行，应用启动时自动创建）。

> 如需在本地直接连接线上数据库调试：在 Vercel 项目的 Settings → Environment Variables
> 复制 `POSTGRES_URL`，写入项目根目录的 `.env.local`（该文件已被 gitignore），再重启 `npm run dev`。

---

## 目录结构

```
app/                页面与 API 路由（Route Handlers）
  page.tsx          首页（重定向至设备管理）
  login/            管理员登录页
  equipment/        设备管理（+ CSV 导入向导）
  borrows/          借用登记（审批 / 归还）
  prints/           3D 打印服务
  api/              /api/equipment|borrows|prints|stats|auth
proxy.ts            登录拦截（未登录重定向至 /login）
components/         通用 UI（弹窗 / 徽标 / Toast 等）
lib/
  types.ts          类型与状态机定义（前后端共用）
  store.ts          数据层（Vercel Postgres / 本地 JSON 自动切换，自动建表）
  auth.ts           密码哈希校验 + 会话签名
  csv.ts            CSV 解析 / 列映射 / 模板
  api.ts            客户端请求封装
db/init.sql        Postgres 表结构（仅供参考，应用会自动建表）
```
