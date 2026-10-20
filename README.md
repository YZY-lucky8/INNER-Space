# INNERSCAPE · 真我

基于 Human 3.0 成长模型的个人成长观照平台，通过科学测评、动态可视化、深度诊断与个性化定制，帮助用户了解真正的自己。数据库系统课程大作业。

## 项目简介

INNERSCAPE 面向个人成长场景，围绕用户画像、目标管理、行为记录与成长反馈构建数据模型，采用 MySQL 8 落地 21 张数据表、4 个视图、3 个存储过程与 3 个触发器，前端为单文件 HTML 实现，可离线打开演示。

## 目录结构

```
INNERSPACE/
├── src/                    前端源码
│   └── index.html          单文件入口，零外部依赖、可离线打开
├── database/               MySQL 数据库脚本
│   ├── schema.sql          建表脚本（21 张表 + 约束）
│   ├── views.sql           视图（4 个）
│   ├── procedures.sql      存储过程（3 个）
│   └── triggers.sql        触发器（3 个）
├── docs/                   设计与交付文档
├── .gitignore
└── README.md
```

## 环境与部署

1. 安装 MySQL 8.0，创建数据库：

```sql
CREATE DATABASE innerspace DEFAULT CHARACTER SET utf8mb4;
```

2. 按顺序导入脚本：

```bash
mysql -u root -p innerspace < database/schema.sql
mysql -u root -p innerspace < database/views.sql
mysql -u root -p innerspace < database/procedures.sql
mysql -u root -p innerspace < database/triggers.sql
```

3. 浏览器直接打开 `src/index.html` 即可预览前端界面。

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 前端 | HTML5 + CSS3 + 原生 JavaScript（单文件） |
| 数据库 | MySQL 8.0（InnoDB / utf8mb4） |
| 版本控制 | Git + GitHub |

## 提交规范

本项目采用 Conventional Commits 前缀：

| 前缀 | 用途 |
| --- | --- |
| `feat` | 新增功能 |
| `fix` | 修复缺陷 |
| `docs` | 文档变更 |
| `chore` | 构建、配置、初始化等杂项 |
| `refactor` | 重构（不改变行为） |
| `style` | 格式调整 |

示例：`docs: 提交大作业报告初稿`

## 分支约定

- `main`：主分支，保持可交付状态
- 功能开发使用 `feature/<模块名>` 分支，合并前需通过自测
