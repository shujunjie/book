import { createClient } from '@supabase/supabase-js';

// --- 配置区域 ---

const SILICON_FLOW_KEY = process.env.SILICON_FLOW_KEY || "sk-xxixqhxkjktxixlixpzhcathfiqqarccplxsswreltvihibx";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://lsggbiatbucdhhrgftra.supabase.co";

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxzZ2diaWF0YnVjZGhocmdmdHJhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2Mzg5MDQ3MiwiZXhwIjoyMDc5NDY2NDcyfQ.4D7v0spqEHFZ8tkgOLKrVg7dYGwmYaFW_yAQNxGnWgk"; 
// 🟢 定义标准分类
const STANDARD_CATEGORIES = ['餐饮', '交通', '购物', '娱乐', '居住', '医疗', '工资', '其他'];

// 🟢 分类清洗函数
function normalizeCategory(input) {
    if (!input) return '其他';
    if (STANDARD_CATEGORIES.includes(input)) return input;

    if (input.includes('食') || input.includes('餐') || input.includes('吃') || input.includes('饮')) return '餐饮';
    if (input.includes('交通') || input.includes('车') || input.includes('行') || input.includes('路')) return '交通';
    if (input.includes('购') || input.includes('买') || input.includes('超') || input.includes('店')) return '购物';
    if (input.includes('玩') || input.includes('乐') || input.includes('游') || input.includes('影')) return '娱乐';
    if (input.includes('房') || input.includes('住') || input.includes('电') || input.includes('水')) return '居住';
    if (input.includes('医') || input.includes('药') || input.includes('病')) return '医疗';
    if (input.includes('薪') || input.includes('资')) return '工资';

    return '其他';
}

// 🟢 获取当前北京时间字符串
function getBeijingTime() {
    return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).format(new Date()).replace(/\//g, '-'); 
}

export default async function handler(req, res) {
    // 1. 跨域处理
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method === 'GET') return res.status(200).json({ status: "active" });

    // 2. 获取参数
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ success: false, message: "未接收到图片数据" });

    try {
        // 获取当前准确的北京时间作为 AI 的参考
        const currentTime = getBeijingTime();
        console.log("当前北京时间:", currentTime);

        // 3. 调用 AI
        const aiResponse = await fetch("https://api.siliconflow.cn/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${SILICON_FLOW_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "Qwen/Qwen2-VL-72B-Instruct",
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
                            { 
                                type: "text", 
                                text: `你是一个账单解析助手。请分析图片并提取信息。
                                
                                当前参考北京时间是：${currentTime}

                                提取要求：
                                1. amount: 金额数字。
                                2. merchant: 商户名称。
                                3. category: 必须从 [${STANDARD_CATEGORIES.join(', ')}] 中选一个。
                                4. date: 格式必须为 yyyy-MM-dd HH:mm:ss。
                                   - 如果图片有完整日期，直接提取。
                                   - 如果图片只有月日（如12-21），请结合当前参考时间补全为 ${currentTime.split(' ')[0].split('-')[0]}-12-21。
                                   - 如果图片完全没有日期，请直接返回：${currentTime}。
                                5. note: 简短备注。

                                返回纯 JSON 格式，不要包含任何 markdown 标识或额外文字。`
                            }
                        ]
                    }
                ],
                max_tokens: 512,
                temperature: 0.1, // 降低随机性，让它更听话
                stream: false
            })
        });

        const aiData = await aiResponse.json();
        if (aiData.error) throw new Error(aiData.error.message);

        const rawContent = aiData.choices?.[0]?.message?.content;
        if (!rawContent) throw new Error("AI 返回内容为空");

        // 4. 解析与清洗
        const jsonStr = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
        let billData;
        try {
            billData = JSON.parse(jsonStr);
        } catch (e) {
            throw new Error("AI 返回的 JSON 格式非法: " + rawContent);
        }

        // 强制清洗分类
        billData.category = normalizeCategory(billData.category);
        
        // 强制检查日期，如果 AI 还是抽风返回了空或者不全，用当前时间兜底
        if (!billData.date || billData.date.length < 10) {
            billData.date = currentTime;
        }

        // 5. 写入数据库
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { error } = await supabase.from('transactions').insert([{
            amount: Math.abs(parseFloat(billData.amount)) || 0,
            merchant: billData.merchant || '未知商户',
            category: billData.category,
            date: billData.date,
            note: billData.note || 'AI 自动记账'
        }]);

        if (error) throw error;

        return res.status(200).json({ 
            success: true, 
            data: billData, 
            message: "记账成功！" 
        });

    } catch (err) {
        console.error("处理失败:", err);
        return res.status(500).json({ success: false, error: err.message });
    }
}

