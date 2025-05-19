# SDU DeepSeek API

-   项目基于[SDU-DeepSeek](https://github.com/futz12/SDU_DeepSeek)
-   开发者不对使用者的不端行为做任何责任承担
-   本版本使用 TypeScript 重写，功能与原始 Python 版本完全相同

## 安装与使用

### 安装依赖

```bash
npm install
```

### 编译 TypeScript

```bash
npm run build
```

### 运行

```bash
npm start
```

### 开发模式

```bash
npm run dev
```

## API 使用方式

API 与 OpenAI 接口兼容，可以通过 `/v1/chat/completions` 路径访问。

### 模型支持

-   `deepseek_reasoner_web`: 深度思考 + 网络搜索
-   `deepseek_reasoner`: 深度思考
-   `deepseek_web`: 网络搜索
-   `deepseek`: 普通模式
-   `QwQ`
-   `QwQ_web`
-   `QwQ_reasoner`
-   `QwQ_reasoner_web`

# Thx

-   SDU
-   [SDU-DeepSeek](https://github.com/futz12/SDU_DeepSeek)
