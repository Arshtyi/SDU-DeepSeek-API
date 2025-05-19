/**
 * 三重DES加密主函数
 * @param data 要加密的数据
 * @param keys 加密密钥
 * @returns 加密后的十六进制字符串
 */
export function strEnc(data: string, ...keys: string[]): string {
    if (!data || keys.some((key) => !key)) {
        throw new Error("Keys and data must not be empty.");
    }

    let result = "";
    for (let i = 0; i < data.length; i += 4) {
        const block = data.substring(i, i + 4).padEnd(4, "\0");
        result += bt64ToHex(processBlock(block, keys));
    }

    return result;
}

/**
 * 处理4字符数据块，应用所有密钥
 * @param block 4字符块
 * @param keys 密钥数组
 * @returns 处理后的二进制数据
 */
function processBlock(block: string, keys: string[]): number[] {
    let bt = strToBt(block);

    // 展开所有密钥并进行三轮加密
    for (const key of keys) {
        const keyBytes = getKeyBytes(key);
        for (const keyByte of keyBytes) {
            bt = enc(bt, keyByte);
        }
    }

    return bt;
}

/**
 * 64位二进制转16位十六进制
 * @param byteData 64位二进制数据
 * @returns 十六进制字符串
 */
function bt64ToHex(byteData: number[]): string {
    let hex = "";
    for (let i = 0; i < 16; i++) {
        const bt = byteData
            .slice(i * 4, i * 4 + 4)
            .map((bit) => bit.toString())
            .join("");
        hex += bt4ToHex(bt);
    }
    return hex;
}

/**
 * 4位二进制转1位十六进制
 * @param bt 4位二进制字符串
 * @returns 1位十六进制字符串
 */
function bt4ToHex(bt: string): string {
    if (bt.length !== 4 || !/^[01]{4}$/.test(bt)) {
        return "";
    }
    return parseInt(bt, 2).toString(16).toUpperCase();
}

/**
 * 将字符串密钥转换为二进制块
 * @param key 密钥字符串
 * @returns 二进制密钥块数组
 */
function getKeyBytes(key: string): number[][] {
    const result: number[][] = [];
    for (let i = 0; i < key.length; i += 4) {
        const block = key.substring(i, i + 4).padEnd(4, "\0");
        result.push(strToBt(block));
    }
    return result;
}

/**
 * 生成16轮子密钥
 * @param keyByte 密钥二进制数据
 * @returns 子密钥数组
 */
function generateKeys(keyByte: number[]): number[][] {
    // 初始密钥置换
    const key: number[] = [];
    for (let i = 0; i < 7; i++) {
        for (let j = 0; j < 8; j++) {
            key.push(keyByte[8 * (7 - j) + i]);
        }
    }
    // 分割左右28位
    let left = key.slice(0, 28);
    let right = key.slice(28);
    // 生成16轮子密钥
    const subkeys: number[][] = [];
    const shifts = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
    const pc2 = [
        13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6,
        26, 19, 12, 1, 40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 47, 43, 48,
        38, 55, 33, 52, 45, 41, 49, 35, 28, 31,
    ];

    for (const shift of shifts) {
        left = [...left.slice(shift), ...left.slice(0, shift)];
        right = [...right.slice(shift), ...right.slice(0, shift)];

        const combined = [...left, ...right];
        const subkey: number[] = [];
        for (let i = 0; i < 48; i++) {
            subkey.push(combined[pc2[i]]);
        }
        subkeys.push(subkey);
    }

    return subkeys;
}

/**
 * 单轮DES加密
 * @param dataByte 数据二进制
 * @param keyByte 密钥二进制
 * @returns 加密后的二进制数据
 */
function enc(dataByte: number[], keyByte: number[]): number[] {
    const keys = generateKeys(keyByte);

    // 初始置换
    const ipIndices = [
        57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53, 45,
        37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7, 56, 48, 40, 32, 24,
        16, 8, 0, 58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4,
        62, 54, 46, 38, 30, 22, 14, 6,
    ];
    const ipByte: number[] = [];
    for (const idx of ipIndices) {
        ipByte.push(dataByte[idx]);
    }

    // 分割左右32位
    let ipLeft = ipByte.slice(0, 32);
    let ipRight = ipByte.slice(32);

    // 16轮Feistel网络
    for (let i = 0; i < 16; i++) {
        // 保存临时左半部分
        const tempLeft = [...ipLeft];

        // 右半部分扩展置换
        const expandIndices = [
            31, 0, 1, 2, 3, 4, 3, 4, 5, 6, 7, 8, 7, 8, 9, 10, 11, 12, 11, 12,
            13, 14, 15, 16, 15, 16, 17, 18, 19, 20, 19, 20, 21, 22, 23, 24, 23,
            24, 25, 26, 27, 28, 27, 28, 29, 30, 31, 0,
        ];
        const expanded: number[] = [];
        for (const idx of expandIndices) {
            expanded.push(ipRight[idx]);
        }

        // 轮函数处理
        const sboxResult = sBoxPermute(xor(expanded, keys[i]));

        const pboxIndices = [
            15, 6, 19, 20, 28, 11, 27, 16, 0, 14, 22, 25, 4, 17, 30, 9, 1, 7,
            23, 13, 31, 26, 2, 8, 18, 12, 29, 5, 21, 10, 3, 24,
        ];
        const pboxResult: number[] = [];
        for (const idx of pboxIndices) {
            pboxResult.push(sboxResult[idx]);
        }

        // 生成新右半部分
        ipLeft = [...ipRight];
        ipRight = xor(tempLeft, pboxResult);
    }

    // 最终置换
    const finalData = [...ipRight, ...ipLeft];
    const fpIndices = [
        39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45,
        13, 53, 21, 61, 29, 36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51,
        19, 59, 27, 34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25,
        32, 0, 40, 8, 48, 16, 56, 24,
    ];

    const result: number[] = [];
    for (const idx of fpIndices) {
        result.push(finalData[idx]);
    }

    return result;
}

/**
 * 异或操作
 * @param byteOne 二进制数据1
 * @param byteTwo 二进制数据2
 * @returns 异或结果
 */
function xor(byteOne: number[], byteTwo: number[]): number[] {
    return byteOne.map((bit, idx) => bit ^ byteTwo[idx]);
}

/**
 * S盒置换
 * @param expandByte 扩展后的二进制数据
 * @returns S盒输出
 */
function sBoxPermute(expandByte: number[]): number[] {
    const sBoxes = [
        // S1
        [
            [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7],
            [0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8],
            [4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0],
            [15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
        ],
        // S2
        [
            [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10],
            [3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5],
            [0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15],
            [13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
        ],
        // S3
        [
            [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8],
            [13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1],
            [13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7],
            [1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
        ],
        // S4
        [
            [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15],
            [13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9],
            [10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4],
            [3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
        ],
        // S5
        [
            [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9],
            [14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6],
            [4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14],
            [11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
        ],
        // S6
        [
            [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11],
            [10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8],
            [9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6],
            [4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
        ],
        // S7
        [
            [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1],
            [13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6],
            [1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2],
            [6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
        ],
        // S8
        [
            [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7],
            [1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2],
            [7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8],
            [2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
        ],
    ];

    const sBoxByte: number[] = [];

    for (let m = 0; m < 8; m++) {
        // 计算S盒索引
        const i = expandByte[m * 6] * 2 + expandByte[m * 6 + 5];
        const j =
            (expandByte[m * 6 + 1] << 3) |
            (expandByte[m * 6 + 2] << 2) |
            (expandByte[m * 6 + 3] << 1) |
            expandByte[m * 6 + 4];

        // 获取S盒输出值
        const sBoxValue = sBoxes[m][i][j];

        // 添加4位输出
        for (let k = 0; k < 4; k++) {
            sBoxByte.push((sBoxValue >> (3 - k)) & 1);
        }
    }

    return sBoxByte;
}

/**
 * 字符串转64位二进制
 * @param s 输入字符串
 * @returns 64位二进制数组
 */
function strToBt(s: string): number[] {
    const padded = s.padEnd(4, "\0").substring(0, 4);
    const result: number[] = [];

    for (let i = 0; i < padded.length; i++) {
        const charCode = padded.charCodeAt(i);
        for (let j = 0; j < 16; j++) {
            result.push((charCode >> (15 - j)) & 1);
        }
    }

    return result;
}
