import { createClient } from '@supabase/supabase-js';

// --- 配置区域 ---
const SILICON_FLOW_KEY = process.env.SILICON_FLOW_KEY || "sk-xxixqhxkjktxixlixpzhcathfiqqarccplxsswreltvihibx";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://lsggbiatbucdhhrgftra.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxzZ2diaWF0YnVjZGhocmdmdHJhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2Mzg5MDQ3MiwiZXhwIjoyMDc5NDY2NDcyfQ.4D7v0spqEHFZ8tkgOLKrVg7dYGwmYaFW_yAQNxGnWgk"; 

// 🟢 定义标准分类 (必须和前端一致)
const STANDARD_CATEGORIES = ['餐饮', '交通', '购物', '娱乐', '居住', '医疗', '工资', '其他'];

// 🟢 分类清洗函数
function normalizeCategory(input) {
    if (!input) return '其他';
    
    // 1. 如果完全匹配，直接返回
    if (STANDARD_CATEGORIES.includes(input)) return input;

    // 2. 模糊匹配 (AI 有时候会多字少字)
    if (input.includes('食') || input.includes('餐') || input.includes('吃') || input.includes('饮')) return '餐饮';
    if (input.includes('交通') || input.includes('车') || input.includes('行') || input.includes('路')) return '交通';
    if (input.includes('购') || input.includes('买') || input.includes('超') || input.includes('店')) return '购物';
    if (input.includes('玩') || input.includes('乐') || input.includes('游') || input.includes('影')) return '娱乐';
    if (input.includes('房') || input.includes('住') || input.includes('电') || input.includes('水')) return '居住';
    if (input.includes('医') || input.includes('药') || input.includes('病')) return '医疗';
    if (input.includes('薪') || input.includes('资')) return '工资';

    // 3. 实在识别不了，归为其他
    return '其他';
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
    console.log("开始调用 AI...");

    // 3. 调用 AI (优化了提示词)
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
                  // 🔥 核心修改：明确告诉 AI 只能选哪些词
                  text: `分析账单图片。提取：amount(金额数字), merchant(商户名), category(必须严格从以下列表中选择一个最匹配的: [${STANDARD_CATEGORIES.join(', ')}]), date(YYYY-MM-DD), note(简短备注)。返回纯JSON。` 
              }
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

    // 4. 解析与清洗
    const jsonStr = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
    let billData = JSON.parse(jsonStr);

    // 🔥 核心修改：强制清洗分类
    billData.category = normalizeCategory(billData.category);

    // 5. 写入数据库
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error } = await supabase.from('transactions').insert([{
      amount: Math.abs(parseFloat(billData.amount)),
      merchant: billData.merchant || '未知商户',
      category: billData.category, // 这里的 category 已经是清洗过的标准词了
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
