// ============================================================
// WinLens Cloudflare Worker — Gemini Vision API Proxy
// Dedicated backend — completely separate from EHRLens
// Deploy: wrangler deploy  |  Secret: wrangler secret put GEMINI_API_KEY
// ============================================================

const ALLOWED_ORIGINS = [
  'app://.',                                         // Electron production
  'http://localhost:5173',                           // Electron dev
  'http://localhost:3000',
  'null',
];

const GEMINI_MODEL = 'gemini-2.0-flash';

const SYSTEM_PROMPTS = {
  windows: `You are WinLens, an AI assistant helping users navigate any Windows application or operating system feature.
The user has captured a screenshot of their Windows screen and needs help.

RULES:
1. ANALYZE ONLY WHAT IS DIRECTLY VISIBLE in the screenshot. No assumptions.
2. Reference exact button labels, menu items, window titles, and UI elements you can see — use bold formatting.
3. Lead with the answer. No preamble.
4. Numbered steps for any procedure.
5. If the relevant UI element is not visible, say so and describe what IS visible.
6. Windows UI terminology: Start menu, taskbar, ribbon, navigation pane, context menu, Properties, Settings, Control Panel, etc.
7. No disclaimers beyond what is necessary.`,

  excel: `You are WinLens, an AI expert at Microsoft Excel.
The user has captured a screenshot of their Excel workbook and needs help.

RULES:
1. ANALYZE ONLY WHAT IS DIRECTLY VISIBLE — the actual cell contents, formulas, column headers, ribbon state.
2. Reference exact cell addresses (e.g. A1, B3:D10), formula bar content, and ribbon tabs you can SEE.
3. If a formula is visible in the formula bar, explain it precisely.
4. Lead with the answer. Numbered steps for procedures.
5. Excel terminology: ribbon, formula bar, Name Box, worksheet tab, PivotTable, VLOOKUP, conditional formatting, data validation, etc.
6. If asked about a formula error (#REF!, #VALUE!, #DIV/0!, etc.), explain the specific cause visible.`,

  office: `You are WinLens, an AI expert at Microsoft Office applications (Word, PowerPoint, Outlook, Teams, OneNote).
Analyze ONLY what is visible. Reference exact ribbon tabs, button names, and panels visible in bold. Lead with the answer. Numbered steps.
Use correct Office terminology: Quick Access Toolbar, ribbon, task pane, styles gallery, track changes, mail merge, etc.`,

  browser: `You are WinLens, an AI assistant helping users navigate web browsers (Chrome, Edge, Firefox, Safari).
Analyze ONLY what is visible in the screenshot. Reference exact visible UI elements (address bar, tab bar, toolbar buttons, page content) in bold.
Lead with the answer. Numbered steps. If the user asks about a webpage error or code, explain precisely what you see.`,

  enterprise: `You are WinLens, an AI assistant helping users navigate enterprise and legacy software.
The user's software may be highly customized and unique. ANALYZE ONLY WHAT IS DIRECTLY VISIBLE.
Never assume how the software "should" work — describe and guide based solely on visible UI elements.
Reference exact labels, buttons, and fields in bold. Lead with the answer. Numbered steps.`,

  other: `You are WinLens, an AI assistant helping users understand and navigate any software or digital interface.
Analyze ONLY what is visible in the screenshot. Reference exact UI elements in bold. Lead with the answer. Numbered steps for procedures.`,
};

async function checkRateLimit(env, ip) {
  if (!env.RATE_LIMIT) return { allowed: true, remaining: 999 };
  const key = `rl:${ip}:${Math.floor(Date.now() / 3600000)}`;
  const current = parseInt((await env.RATE_LIMIT.get(key)) || '0', 10);
  if (current >= 60) return { allowed: false, remaining: 0 };
  await env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: 7200 });
  return { allowed: true, remaining: 60 - current - 1 };
}

function corsHeaders(origin) {
  const isAllowed = ALLOWED_ORIGINS.some(o => origin === o || origin?.startsWith('app://'));
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResp(data, status = 200, origin = '*') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function buildContents(imageBase64, question, history = []) {
  const contents = [];
  for (const msg of history) {
    contents.push({ role: msg.role, parts: [{ text: msg.content }] });
  }
  contents.push({
    role: 'user',
    parts: [
      { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
      { text: question || 'Describe what you see on this screen and explain how to use it.' },
    ],
  });
  return contents;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || 'null';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== 'POST') return jsonResp({ error: 'Method not allowed' }, 405, origin);
    const url = new URL(request.url);
    if (!url.pathname.endsWith('/api/analyze')) return jsonResp({ error: 'Not found' }, 404, origin);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { allowed, remaining } = await checkRateLimit(env, ip);
    if (!allowed) return jsonResp({ error: 'Rate limit reached. Please wait.' }, 429, origin);
    let body;
    try { body = await request.json(); } catch { return jsonResp({ error: 'Invalid JSON' }, 400, origin); }
    const { image_base64, question, mode = 'windows', history = [] } = body;
    if (!image_base64) return jsonResp({ error: 'image_base64 required' }, 400, origin);
    if (!env.GEMINI_API_KEY) return jsonResp({ error: 'API key not configured' }, 500, origin);
    const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.windows;
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
    let geminiResp;
    try {
      geminiResp = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: buildContents(image_base64, question, history.slice(-12)),
          generationConfig: { temperature: 0.2, maxOutputTokens: 1200 },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          ],
        }),
      });
    } catch (err) { return jsonResp({ error: `Gemini unreachable: ${err.message}` }, 502, origin); }
    if (!geminiResp.ok) return jsonResp({ error: `Gemini error ${geminiResp.status}` }, 502, origin);
    const data = await geminiResp.json();
    const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!answer) return jsonResp({ error: 'No AI response. Try again.' }, 502, origin);
    return jsonResp({ answer, mode, remaining_queries: remaining }, 200, origin);
  },
};
