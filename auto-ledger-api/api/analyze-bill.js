import { createClient } from '@supabase/supabase-js';

// --- 配置区域 ---
// 为了安全，建议在 Vercel 后台环境变量设置，但为了你方便，这里先写死
const SILICON_FLOW_KEY = process.env.SILICON_FLOW_KEY || "sk-xxixqhxkjktxixlixpzhcathfiqqarccplxsswreltvihibx";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://lsggbiatbucdhhrgftra.supabase.co";
// 🔴 已填入你的 service_role key (拥有绕过 RLS 写入数据库的权限)
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxzZ2diaWF0YnVjZGhocmdmdHJhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2Mzg5MDQ3MiwiZXhwIjoyMDc5NDY2NDcyfQ.4D7v0spqEHFZ8tkgOLKrVg7dYGwmYaFW_yAQNxGnWgk"; 

export default async function handler(req, res) {
  // 1. 处理跨域 (CORS) - 允许快捷指令调用
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // 处理预检请求
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // 2. 获取参数
  const { imageBase64 } = req.body;

  if (!imageBase64) {
    return res.status(400).json({ success: false, message: "未接收到图片数据" });
  }

  try {
    console.log("开始调用 AI...");

    // 3. 调用硅基流动
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
    if (aiData.error) throw new Error(aiData.error.message);

    const rawContent = aiData.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error("AI 返回为空");

    // 4. 清洗 JSON
    const jsonStr = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
    const billData = JSON.parse(jsonStr);

    // 5. 写入 Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error } = await supabase.from('transactions').insert([{
      amount: Math.abs(parseFloat(billData.amount)),
      merchant: billData.merchant || '未知',
      category: billData.category || '其他',
      date: billData.date || new Date().toISOString(),
      note: billData.note || 'AI 记账'
    }]);

    if (error) throw error;

    return res.status(200).json({ success: true, data: billData, message: "记账成功！" });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
}