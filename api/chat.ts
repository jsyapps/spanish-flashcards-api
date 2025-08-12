import { VercelRequest, VercelResponse } from '@vercel/node';

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

// Rate limiting configuration
const RATE_LIMIT = {
  maxRequests: 100, // Maximum requests per time window
  windowMs: 60 * 60 * 1000, // 1 hour in milliseconds
};

function checkRateLimit(ip: string): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const key = ip;
  
  // Get or create rate limit entry for this IP
  let entry = rateLimitMap.get(key);
  
  // Reset if window has expired
  if (!entry || now > entry.resetTime) {
    entry = {
      count: 0,
      resetTime: now + RATE_LIMIT.windowMs,
    };
  }
  
  // Check if rate limit exceeded
  if (entry.count >= RATE_LIMIT.maxRequests) {
    rateLimitMap.set(key, entry);
    return {
      allowed: false,
      remaining: 0,
      resetTime: entry.resetTime,
    };
  }
  
  // Increment count and allow request
  entry.count++;
  rateLimitMap.set(key, entry);
  
  return {
    allowed: true,
    remaining: RATE_LIMIT.maxRequests - entry.count,
    resetTime: entry.resetTime,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get client IP address
  const clientIP = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || 
                   req.headers['x-real-ip'] as string || 
                   req.connection?.remoteAddress || 
                   'unknown';

  // Rate limiting check
  const rateLimitResult = checkRateLimit(clientIP);
  
  if (!rateLimitResult.allowed) {
    const resetDate = new Date(rateLimitResult.resetTime);
    return res.status(429).json({ 
      error: 'Rate limit exceeded',
      message: `Too many requests. Rate limit resets at ${resetDate.toISOString()}`,
      resetTime: rateLimitResult.resetTime
    });
  }

  // Add rate limit headers
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT.maxRequests);
  res.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining);
  res.setHeader('X-RateLimit-Reset', rateLimitResult.resetTime);

  // API Authentication
  const authHeader = req.headers.authorization;
  const expectedKey = process.env.BETA_API_KEY;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header required' });
  }
  
  const providedKey = authHeader.replace('Bearer ', '');
  if (providedKey !== expectedKey) {
    console.log(`Unauthorized API access attempt from ${req.headers['x-forwarded-for'] || req.connection?.remoteAddress}`);
    return res.status(401).json({ error: 'Invalid API key' });
  }

  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        messages: [
          {
            role: 'system',
            content: 'Task: Translate between Mexican Spanish and English for flashcard study. For Spanish input, provide the English meaning. For English input, provide the most common Mexican Spanish translation. Tone: Use everyday, conversational Mexican Spanish words and phrases that are commonly used in daily life. Avoid formal, literary, or regional variants from other Spanish-speaking countries. Rules: - Keep responses brief and direct - ideal for quick flashcard review - Do not repeat the original term in your response - Use only the most common Mexican Spanish words - Provide single, clear translations without explanations'
          },
          {
            role: 'user',
            content: message
          }
        ],
        max_tokens: 500,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.choices[0]?.message?.content;

    if (!aiResponse) {
      throw new Error('No response from OpenAI');
    }

    res.status(200).json({ response: aiResponse });
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: 'Failed to get response from AI' });
  }
}