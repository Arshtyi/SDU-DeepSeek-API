import axios from "axios";

// 导出一个封装的cookies对象，通过函数来访问和修改
let _cookies: Record<string, string> = {};

function getCookies(): Record<string, string> {
    return _cookies;
}

function setCookies(newCookies: Record<string, string>): void {
    _cookies = newCookies;
}

const url = "https://aiassist.sdu.edu.cn/site/ai/compose_chat";

class ChatSession {
    role: string;
    content: string;

    constructor() {
        this.role = "user"; // user or assistant
        this.content = "";
    }
}

class ChatConfig {
    compose_id: number;
    auth_tag: string;
    deep_search: number; // 深度思考
    internet_search: number; // 网络搜索

    constructor() {
        this.compose_id = 73;
        this.auth_tag = "本科生";
        this.deep_search = 1;
        this.internet_search = 1;
    }
}

function historyToFormData(history: ChatSession[]): Record<string, any> {
    const formData: Record<string, any> = {};
    let offset = 0;

    for (let i = 0; i < history.length; i++) {
        const chatSession = history[i];
        if (chatSession.role === "system") {
            formData[`history[${i + offset}][role]`] = "user";
            formData[`history[${i + offset}][content]`] = chatSession.content;

            offset += 1;
            formData[`history[${i + offset}][role]`] = "assistant";
            formData[`history[${i + offset}][content]`] = "我知道了";

            continue;
        }

        formData[`history[${i + offset}][role]`] = chatSession.role;
        formData[`history[${i + offset}][content]`] = chatSession.content;
    }

    return formData;
}

function makeChatRequest(
    content: string,
    history: ChatSession[],
    config: ChatConfig
): Record<string, any> {
    const formData: Record<string, any> = {};
    formData["content"] = content;
    Object.assign(formData, historyToFormData(history));
    formData["compose_id"] = config.compose_id;
    formData["auth_tag"] = config.auth_tag;
    formData["deep_search"] = config.deep_search;
    formData["internet_search"] = config.internet_search;

    return formData;
}

async function* chat(
    content: string,
    history: ChatSession[],
    config: ChatConfig
): AsyncGenerator<string, void, unknown> {
    const formData = makeChatRequest(content, history, config);
    // 流式输出
    const response = await axios.post(url, formData, {
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: Object.entries(getCookies())
                .map(([k, v]) => `${k}=${v}`)
                .join("; "),
        },
        withCredentials: true,
        responseType: "stream",
        validateStatus: () => true, // 允许所有状态码
    });

    const stream = response.data;
    let buffer = "";

    for await (const chunk of stream) {
        buffer += chunk.toString();
        let lines = buffer.split("\n");

        // 处理完整的行，保留最后一个可能不完整的行
        buffer = lines.pop() || "";

        for (const line of lines) {
            if (line.startsWith("data: ")) {
                try {
                    const text = line.substring(6); // 去掉 'data: '
                    const jsonData = JSON.parse(text);
                    yield jsonData.d.answer;
                } catch (error) {
                    console.error("Error parsing JSON:", error);
                }
            }
        }
    }
}

export { ChatSession, ChatConfig, chat, getCookies, setCookies };
