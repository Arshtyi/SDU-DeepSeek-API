import axios from "axios";
import * as crypto from "crypto";
import { v4 as uuidv4, v5 as uuidv5 } from "uuid";
import { strEnc } from "./UniformLoginDes";
import * as readline from "readline";
import * as fs from "fs";

/**
 * 登录函数
 * @param sduid 学号
 * @param password 密码
 * @param fingerprint 指纹(设备标识)
 * @returns 登录结果，包含cookies和过期时间
 */
export async function login(
    sduid: string,
    password: string,
    fingerprint: string = uuidv4()
): Promise<{ cookies: Record<string, string>; expires: Date }> {
    // 获取登录页面
    const pageResponse = await axios.get("https://pass.sdu.edu.cn/cas/login", {
        params: {
            service:
                "https://aiassist.sdu.edu.cn/common/actionCasLogin?redirect_url=https%3A%2F%2Faiassist.sdu.edu.cn%2Fpage%2Fsite%2FnewPc%3Flogin_return%3Dtrue",
        },
    });

    const pageCookies: Record<string, string> = {};
    if (pageResponse.headers["set-cookie"]) {
        pageResponse.headers["set-cookie"].forEach((cookie: string) => {
            const [cookiePair] = cookie.split(";");
            const [name, value] = cookiePair.split("=");
            pageCookies[name] = value;
        });
    }

    // 从页面提取lt, execution和eventId
    const ltMatch = pageResponse.data.match(/"lt" value="(.*?)"/);
    const executionMatch = pageResponse.data.match(/"execution" value="(.*?)"/);
    const eventIdMatch = pageResponse.data.match(/"_eventId" value="(.*?)"/);

    if (!ltMatch || !executionMatch || !eventIdMatch) {
        throw new Error("无法从登录页面提取必要信息");
    }

    const lt = ltMatch[1];
    const execution = executionMatch[1];
    const eventId = eventIdMatch[1];

    // 计算设备指纹的哈希
    const murmurS = crypto
        .createHash("sha256")
        .update(fingerprint)
        .digest("hex");
    const murmurMd5 = crypto.createHash("md5").update(murmurS).digest("hex");

    // 加密用户名和密码
    const encryptedUsername = strEnc(sduid, "1", "2", "3");
    const encryptedPassword = strEnc(password, "1", "2", "3");
    const rsa = strEnc(sduid + password + lt, "1", "2", "3");

    // 检查设备状态
    const deviceStatusResponse = await axios.post(
        "https://pass.sdu.edu.cn/cas/device",
        new URLSearchParams({
            u: encryptedUsername,
            p: encryptedPassword,
            m: "1", // mode 1 to get if device registered
            d: fingerprint,
            d_s: murmurS,
            d_md5: murmurMd5,
        }),
        { headers: { Cookie: serializeCookies(pageCookies) } }
    );

    const deviceStatusData = deviceStatusResponse.data;

    // 处理设备验证
    switch (deviceStatusData.info) {
        case "binded":
        case "pass":
            console.log("设备已注册或无需验证");
            break;
        case "bind":
            console.log("需要双重验证: " + deviceStatusData.m);

            // 发送短信验证码
            const smsResponse = await axios.post(
                "https://pass.sdu.edu.cn/cas/device",
                new URLSearchParams({ m: "2" }),
                { headers: { Cookie: serializeCookies(pageCookies) } }
            );

            if (smsResponse.data.info === "send") {
                console.log("已发送短信验证码");
            } else {
                throw new Error(
                    `未知的短信状态: ${JSON.stringify(smsResponse.data)}`
                );
            }

            // 获取验证码
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
            });

            const verificationCode = await new Promise<string>((resolve) => {
                rl.question("验证码: ", (answer) => {
                    resolve(answer);
                });
            });

            const rememberDevice = await new Promise<boolean>((resolve) => {
                rl.question("记住此设备? (y/N): ", (answer) => {
                    resolve(answer.toLowerCase() === "y");
                    rl.close();
                });
            });

            // 提交验证码
            let verifyResponse = await axios.post(
                "https://pass.sdu.edu.cn/cas/device",
                new URLSearchParams({
                    d: murmurS,
                    i: fingerprint,
                    m: "3",
                    u: sduid,
                    c: verificationCode,
                    s: rememberDevice ? "1" : "0",
                }),
                { headers: { Cookie: serializeCookies(pageCookies) } }
            );

            // 如果验证码错误，重试
            while (verifyResponse.data.info === "codeErr") {
                const retryCode = await new Promise<string>((resolve) => {
                    const retryRl = readline.createInterface({
                        input: process.stdin,
                        output: process.stdout,
                    });
                    retryRl.question("验证码错误，请重试: ", (answer) => {
                        resolve(answer);
                        retryRl.close();
                    });
                });

                verifyResponse = await axios.post(
                    "https://pass.sdu.edu.cn/cas/device",
                    new URLSearchParams({
                        d: murmurS,
                        i: fingerprint,
                        m: "3",
                        u: sduid,
                        c: retryCode,
                        s: rememberDevice ? "1" : "0",
                    }),
                    { headers: { Cookie: serializeCookies(pageCookies) } }
                );
            }

            if (verifyResponse.data.info === "ok") {
                console.log("登录成功");
                if (rememberDevice) {
                    console.log(
                        `对于设备指纹: ${fingerprint}，下次登录将不再需要验证码`
                    );
                }
            }
            break;
        default:
            console.log("请检查您的用户名。无法加载SDU PASS的设备信息。");
            throw new Error(
                `未知的设备状态: ${JSON.stringify(deviceStatusData)}`
            );
    }

    // 登录
    const loginResponse = await axios.post(
        "https://pass.sdu.edu.cn/cas/login",
        new URLSearchParams({
            rsa,
            ul: sduid.length.toString(),
            pl: password.length.toString(),
            lt,
            execution,
            _eventId: eventId,
        }),
        {
            headers: { Cookie: serializeCookies(pageCookies) },
            params: {
                service:
                    "https://aiassist.sdu.edu.cn/common/actionCasLogin?redirect_url=https%3A%2F%2Faiassist.sdu.edu.cn%2Fpage%2Fsite%2FnewPc%3Flogin_return%3Dtrue",
            },
            maxRedirects: 0,
            validateStatus: (status) => status >= 200 && status < 400,
        }
    );

    // 提取重定向URL
    const locationHeader = loginResponse.headers.location;
    if (!locationHeader) {
        throw new Error("登录响应中没有重定向URL");
    }

    // 访问重定向URL获取最终cookies
    const finalResponse = await axios.get(locationHeader, {
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
    });

    // 提取cookies
    const cookies: Record<string, string> = {};
    if (finalResponse.headers["set-cookie"]) {
        finalResponse.headers["set-cookie"].forEach((cookie: string) => {
            const [cookiePair] = cookie.split(";");
            const [name, value] = cookiePair.split("=");
            cookies[name] = value;
        });
    }

    // 解析expires
    let expires = new Date();
    const headerStr = JSON.stringify(finalResponse.headers);
    const whereExpires = headerStr.indexOf("expires=") + 8;
    if (whereExpires > 8) {
        const expiresStr = headerStr.substring(whereExpires, whereExpires + 29);
        expires = new Date(expiresStr);
    } else {
        // 默认30天过期
        expires.setDate(expires.getDate() + 30);
    }

    return { cookies, expires };
}

/**
 * 将cookies对象序列化为字符串
 * @param cookies cookies对象
 * @returns 序列化后的cookie字符串
 */
function serializeCookies(cookies: Record<string, string>): string {
    return Object.entries(cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join("; ");
}
