import fastify from "fastify";
import fastifyCors from "@fastify/cors";
import * as fs from "node:fs";
import * as path from "node:path";
import { v4 as uuidv4, v5 as uuidv5 } from "uuid";
import * as readline from "node:readline";
import { PassThrough } from "node:stream";

import {
    ChatSession,
    ChatConfig,
    chat,
    getCookies,
    setCookies,
} from "./SduWrap";
import * as loginModule from "./SduAiassistLogin";

// 定义接口类型
interface Message {
    role: string;
    content: string;
}

interface ChatCompletionRequest {
    messages: Message[];
    stream: boolean;
    model: string;
    [key: string]: any;
}

interface ChatCompletionResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: {
        index: number;
        message: {
            role: string;
            content: string;
        };
        finish_reason: string;
    }[];
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

interface ChatCompletionChunk {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: {
        index: number;
        delta: {
            content: string;
        };
        finish_reason: null | string;
    }[];
}

// 启动应用程序的主函数
const startServer = async () => {
    // 创建Fastify实例
    const app = fastify({ logger: true });

    // 注册CORS中间件
    await app.register(fastifyCors, {
        origin: "*",
        credentials: true,
        methods: ["POST", "OPTIONS"],
        allowedHeaders: ["*"],
    });

    // Chat completion endpoint
    app.post<{
        Body: ChatCompletionRequest;
    }>("/v1/chat/completions", async (request, reply) => {
        try {
            const body = request.body;
            const messages = body.messages || [];
            const stream = body.stream || false;
            const model = body.model || "deepseek_reasoner_web";

            const config = new ChatConfig();

            const modelConfig: Record<
                string,
                [number, string, number, number]
            > = {
                deepseek_reasoner_web: [73, "本科生", 1, 1],
                deepseek_reasoner: [73, "本科生", 1, 2],
                deepseek_web: [73, "本科生", 2, 1],
                deepseek: [73, "本科生", 2, 2],
                QwQ: [72, "本科生", 2, 2],
                QwQ_web: [72, "本科生", 2, 1],
                QwQ_reasoner: [72, "本科生", 1, 2],
                QwQ_reasoner_web: [72, "本科生", 1, 1],
            };

            if (model in modelConfig) {
                [
                    config.compose_id,
                    config.auth_tag,
                    config.deep_search,
                    config.internet_search,
                ] = modelConfig[model];
            }

            // 校验消息格式
            if (
                !messages.length ||
                messages[messages.length - 1].role !== "user"
            ) {
                reply.code(400).send({ error: "Invalid messages format" });
                return;
            }

            // 提取当前输入和历史记录
            const currentInput = messages[messages.length - 1].content;
            const history = messages.slice(0, -1); // 除了最后一条以外的所有消息

            // 格式化历史消息为ChatSession格式
            const requestHistory: ChatSession[] = [];
            for (const chatSession of history) {
                const cs = new ChatSession();
                cs.role = chatSession.role;
                cs.content = chatSession.content;
                requestHistory.push(cs);
            }

            // 流式响应处理
            if (stream) {
                reply.raw.setHeader("Content-Type", "text/event-stream");
                reply.raw.setHeader("Cache-Control", "no-cache");
                reply.raw.setHeader("Connection", "keep-alive");

                // 生成唯一响应ID
                const responseId = `sdu_ds-${uuidv4()}`;
                const created = Math.floor(Date.now() / 1000);

                const responseStream = new PassThrough();
                reply.send(responseStream);

                // 处理生成器产生的内容
                for await (const chunk of chat(
                    currentInput,
                    requestHistory,
                    config
                )) {
                    const eventData: ChatCompletionChunk = {
                        id: responseId,
                        object: "chat.completion.chunk",
                        created,
                        model,
                        choices: [
                            {
                                index: 0,
                                delta: { content: chunk },
                                finish_reason: null,
                            },
                        ],
                    };

                    responseStream.write(
                        `data: ${JSON.stringify(eventData)}\n\n`
                    );
                }

                // 结束事件
                responseStream.write("data: [DONE]\n\n");
                responseStream.end();
            }
            // 非流式响应处理
            else {
                // 收集完整响应
                let fullResponse = "";
                for await (const chunk of chat(
                    currentInput,
                    requestHistory,
                    config
                )) {
                    fullResponse += chunk;
                }

                const response: ChatCompletionResponse = {
                    id: `chatcmpl-${uuidv4()}`,
                    object: "chat.completion",
                    created: Math.floor(Date.now() / 1000),
                    model,
                    choices: [
                        {
                            index: 0,
                            message: {
                                role: "assistant",
                                content: fullResponse,
                            },
                            finish_reason: "stop",
                        },
                    ],
                    usage: {
                        prompt_tokens: currentInput.length,
                        completion_tokens: fullResponse.length,
                        total_tokens: currentInput.length + fullResponse.length,
                    },
                };

                return response;
            }
        } catch (error: any) {
            app.log.error(error);
            reply
                .code(500)
                .send({ error: `Internal server error: ${error.message}` });
        }
    });

    try {
        // 检查cookies.json是否存在
        try {
            const cookiesPath = path.join(process.cwd(), "cookies.json");
            if (fs.existsSync(cookiesPath)) {
                const cookiesData = fs.readFileSync(cookiesPath, "utf8");
                const cookies = JSON.parse(cookiesData);

                // 验证cookies不为空
                if (Object.keys(cookies).length === 0) {
                    throw new Error("Empty cookies file");
                }

                setCookies(cookies);
            } else {
                throw new Error("No cookies file");
            }
        } catch (error) {
            console.log("There is no cookies.json file, logging in...");

            // 创建readline接口
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
            });

            // 获取用户输入
            const sduId = await new Promise<string>((resolve) => {
                rl.question("Please enter your SDU ID: ", (answer: string) => {
                    resolve(answer);
                });
            });

            const password = await new Promise<string>((resolve) => {
                rl.question(
                    "Please enter your password: ",
                    (answer: string) => {
                        resolve(answer);
                    }
                );
            });

            // 尝试读取指纹
            let fingerprint: string;
            try {
                const fingerprintPath = path.join(
                    process.cwd(),
                    "fingerprint.txt"
                );
                if (fs.existsSync(fingerprintPath)) {
                    fingerprint = fs
                        .readFileSync(fingerprintPath, "utf8")
                        .trim();
                } else {
                    fingerprint = await new Promise<string>((resolve) => {
                        rl.question(
                            "Please enter your fingerprint(Empty to generate one): ",
                            (answer: string) => {
                                resolve(answer || uuidv4());
                            }
                        );
                    });

                    fs.writeFileSync(fingerprintPath, fingerprint);
                }
            } catch (error) {
                fingerprint = uuidv4();
                fs.writeFileSync(
                    path.join(process.cwd(), "fingerprint.txt"),
                    fingerprint
                );
            }

            // 生成UUID5指纹
            fingerprint = uuidv5(fingerprint, uuidv5.URL);

            // 关闭readline接口
            rl.close();

            // 登录
            const loginResult = await loginModule.login(
                sduId,
                password,
                fingerprint
            );
            if (
                !loginResult.cookies ||
                Object.keys(loginResult.cookies).length === 0
            ) {
                throw new Error("Login failed");
            }

            setCookies(loginResult.cookies);

            // 保存cookies
            fs.writeFileSync(
                path.join(process.cwd(), "cookies.json"),
                JSON.stringify(loginResult.cookies)
            );
        }

        // 启动服务器
        await app.listen({ port: 8000, host: "localhost" });
        console.log("Server is running on http://localhost:8000");
    } catch (err) {
        console.error("Failed to start server:", err);
        process.exit(1);
    }
};

// 执行启动函数
startServer().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
});
