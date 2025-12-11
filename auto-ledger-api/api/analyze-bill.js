import { createClient } from '@supabase/supabase-js';

// --- 配置区域 ---
const SILICON_FLOW_KEY = process.env.SILICON_FLOW_KEY || "sk-xxixqhxkjktxixlixpzhcathfiqqarccplxsswreltvihibx";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://lsggbiatbucdhhrgftra.supabase.co";
// 🔴 已填入你的 service_role key
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxzZ2diaWF0YnVjZGhocmdmdHJhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2Mzg5MDQ3MiwiZXhwIjoyMDc5NDY2NDcyfQ.4D7v0spqEHFZ8tkgOLKrVg7dYGwmYaFW_yAQNxGnWgk"; 

export default async function handler(req, res) {
  // 1. 允许跨域 (CORS) - 让快捷指令能访问
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 处理预检请求
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ✅ 新增：浏览器访问测试 (GET)
  if (req.method === 'GET') {
    return res.status(200).json({ 
      status: "active", 
      message: "API 服务正常运行中！请使用 POST 方法发送图片数据进行记账。" 
    });
  }

  // 只允许 POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 2. 获取参数
  const { imageBase64 } = req.body;

  if (!imageBase64) {
    return res.status(400).json({ success: false, message: "未接收到图片数据 (imageBase64 is missing)" });
  }

  try {
    console.log("开始调用硅基流动 AI...");

    // 3. 调用硅基流动 API
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
              { type: "text", text: "提取图片中的：amount(数字), merchant(商户名), category(餐饮/交通/购物/娱乐/居住/医疗/工资/其他), date(YYYY-MM-DD,无则null), note(备注)。只返回纯JSON，不要Markdown格式。" }
            ]
          }
        ],
        max_tokens: 512,
        stream: false
      })
    });

    const aiData = await aiResponse.json();
    
    // 检查 AI 报错
    if (aiData.error) {
        console.error("AI API Error:", aiData.error);
        throw new Error(`AI API Error: ${aiData.error.message}`);
    }

    const rawContent = aiData.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error("AI 返回内容为空");

    // 4. 清洗 JSON
    const jsonStr = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
    let billData;
    try {
        billData = JSON.parse(jsonStr);
    } catch (e) {
        console.error("JSON Parse Error:", jsonStr);
        throw new Error("AI 返回的数据不是有效的 JSON");
    }

    // 5. 写入 Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error } = await supabase.from('transactions').insert([{
      amount: Math.abs(parseFloat(billData.amount)),
      merchant: billData.merchant || '未知',
      category: billData.category || '其他',
      date: billData.date || new Date().toISOString(),
      note: billData.note || 'AI 记账'
    }]);

    if (error) {
        console.error("Supabase Error:", error);
        throw error;
    }

    return res.status(200).json({ success: true, data: billData, message: "记账成功！" });

  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
