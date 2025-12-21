import { createClient } from '@supabase/supabase-js';

// ==================== 配置区域 ====================
const SILICON_FLOW_KEY =
  process.env.SILICON_FLOW_KEY ||
  'sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxx';

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  'https://lsggbiatbucdhhrgftra.supabase.co';

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

// ==================== 标准分类 ====================
const STANDARD_CATEGORIES = [
  '餐饮',
  '交通',
  '购物',
  '娱乐',
  '居住',
  '医疗',
  '工资',
  '其他'
];

// ==================== 分类清洗 ====================
function normalizeCategory(input) {
  if (!input) return '其他';
  if (STANDARD_CATEGORIES.includes(input)) return input;

  if (/食|餐|吃|饮/.test(input)) return '餐饮';
  if (/交通|车|行|路/.test(input)) return '交通';
  if (/购|买|超|店/.test(input)) return '购物';
  if (/玩|乐|游|影/.test(input)) return '娱乐';
  if (/房|住|水|电/.test(input)) return '居住';
  if (/医|药|病/.test(input)) return '医疗';
  if (/薪|资/.test(input)) return '工资';

  return '其他';
}

// ==================== 北京时间工具 ====================
function getBeijingISOString() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000)
    .toISOString()
    .replace('Z', '');
}

// ==================== 主处理函数 ====================
export default async function handler(req, res) {
  // ---------- CORS ----------
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,OPTIONS,POST'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type'
  );

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET')
    return res.status(200).json({ status: 'active' });

  // ---------- 参数校验 ----------
  const { imageBase64 } = req.body;
  if (!imageBase64) {
    return res.status(400).json({
      success: false,
      message: '未接收到图片数据'
    });
  }

  try {
    // ---------- 调用 AI ----------
    const aiResponse = await fetch(
      'https://api.siliconflow.cn/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SILICON_FLOW_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'Qwen/Qwen2-VL-72B-Instruct',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/jpeg;base64,${imageBase64}`
                  }
                },
                {
                  type: 'text',
                  text: `
分析账单图片，返回 JSON。
字段要求：
- amount: 金额数字
- merchant: 商户名
- category: 必须从以下列表中选择一个最匹配的：
  [${STANDARD_CATEGORIES.join(', ')}]
- date: 仅当图片中【明确出现日期和时间】时，
        返回 yyyy-MM-dd HH:mm:ss；
        如果没有明确日期，请返回 null
- note: 简短备注

只返回 JSON，不要解释。
`
                }
              ]
            }
          ],
          max_tokens: 512,
          stream: false
        })
      }
    );

    const aiData = await aiResponse.json();
    if (aiData.error) throw new Error(aiData.error.message);

    const rawContent =
      aiData.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error('AI 返回为空');

    // ---------- JSON 清洗 ----------
    const jsonStr = rawContent
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();

    let billData = JSON.parse(jsonStr);

    // ---------- 字段清洗 ----------
    billData.category = normalizeCategory(billData.category);
    billData.amount = Math.abs(
      parseFloat(billData.amount || 0)
    );

    // ---------- 时间处理（关键修复点） ----------
    const billDate = billData.date || null; // AI 识别时间
    const recordedAt = getBeijingISOString(); // 服务器时间

    // ---------- 写入数据库 ----------
    const supabase = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY
    );

    const { error } = await supabase
      .from('transactions')
      .insert([
        {
          amount: billData.amount,
          merchant: billData.merchant || '未知商户',
          category: billData.category,
          bill_date: billDate,       // 图片中的时间（可为空）
          recorded_at: recordedAt,   // 实际记账时间（可信）
          note: billData.note || 'AI 记账'
        }
      ]);

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: {
        ...billData,
        bill_date: billDate,
        recorded_at: recordedAt
      },
      message: '记账成功'
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}
