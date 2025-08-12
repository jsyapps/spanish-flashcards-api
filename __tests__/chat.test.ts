import { VercelRequest, VercelResponse } from '@vercel/node';
import handler from '../api/chat';

// Mock fetch for OpenAI API calls
global.fetch = jest.fn();

// Mock console.log to avoid noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
};

describe('/api/chat', () => {
  let req: Partial<VercelRequest>;
  let res: Partial<VercelResponse>;

  beforeEach(() => {
    req = {
      method: 'POST',
      headers: {},
      body: {},
      connection: { remoteAddress: '127.0.0.1' } as any,
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
    };

    // Reset environment variable
    process.env.BETA_API_KEY = 'test-api-key-123';
    process.env.OPENAI_API_KEY = 'test-openai-key';

    // Clear all mocks
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
  });

  describe('Method validation', () => {
    it('should reject non-POST requests', async () => {
      req.method = 'GET';

      await handler(req as VercelRequest, res as VercelResponse);

      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
    });
  });

  describe('Rate limiting', () => {
    it('should allow requests under rate limit', async () => {
      req.headers = {
        authorization: 'Bearer test-api-key-123',
        'x-forwarded-for': '192.168.1.1',
      };
      req.body = { message: 'hola' };

      // Mock successful OpenAI response
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'Hello in English' } }]
        }),
      });

      await handler(req as VercelRequest, res as VercelResponse);

      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 100);
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 99);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should reject requests when rate limit exceeded', async () => {
      req.headers = {
        authorization: 'Bearer test-api-key-123',
        'x-forwarded-for': '192.168.1.2',
      };
      req.body = { message: 'test' };

      // Simulate rate limit exceeded by making 101 requests
      for (let i = 0; i < 101; i++) {
        await handler(req as VercelRequest, res as VercelResponse);
        if (i < 100) {
          // Mock successful OpenAI response for first 100 requests
          (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
              choices: [{ message: { content: 'Response' } }]
            }),
          });
        }
      }

      // The 101st request should be rate limited
      expect(res.status).toHaveBeenLastCalledWith(429);
      expect(res.json).toHaveBeenLastCalledWith(
        expect.objectContaining({
          error: 'Rate limit exceeded',
        })
      );
    });
  });

  describe('Authentication', () => {
    it('should reject requests without authorization header', async () => {
      req.headers = {};
      req.body = { message: 'hola' };

      await handler(req as VercelRequest, res as VercelResponse);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authorization header required' });
    });

    it('should reject requests with invalid API key', async () => {
      req.headers = {
        authorization: 'Bearer invalid-key',
        'x-forwarded-for': '192.168.1.3',
      };
      req.body = { message: 'hola' };

      await handler(req as VercelRequest, res as VercelResponse);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid API key' });
    });

    it('should reject requests with malformed authorization header', async () => {
      req.headers = {
        authorization: 'InvalidFormat test-key',
        'x-forwarded-for': '192.168.1.4',
      };
      req.body = { message: 'hola' };

      await handler(req as VercelRequest, res as VercelResponse);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authorization header required' });
    });

    it('should accept requests with valid API key', async () => {
      req.headers = {
        authorization: 'Bearer test-api-key-123',
        'x-forwarded-for': '10.0.0.1',
      };
      req.body = { message: 'hola' };

      // Mock successful OpenAI response
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce({
          choices: [{ message: { content: 'It means "hello" in English.' } }]
        }),
      });

      await handler(req as VercelRequest, res as VercelResponse);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        response: 'It means "hello" in English.'
      });
    });
  });

  describe('Message validation', () => {
    beforeEach(() => {
      req.headers = {
        authorization: 'Bearer test-api-key-123',
        'x-forwarded-for': '192.168.1.6',
      };
    });

    it('should reject requests without message', async () => {
      req.body = {};

      await handler(req as VercelRequest, res as VercelResponse);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Message is required' });
    });

    it('should reject requests with empty message', async () => {
      req.body = { message: '' };

      await handler(req as VercelRequest, res as VercelResponse);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Message is required' });
    });
  });

  describe('OpenAI integration', () => {
    beforeEach(() => {
      req.headers = {
        authorization: 'Bearer test-api-key-123',
        'x-forwarded-for': '10.0.0.7',
      };
      req.body = { message: 'gato' };
    });

    it('should handle successful OpenAI response', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'It means "cat" in English.' } }]
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce(mockResponse),
      });

      await handler(req as VercelRequest, res as VercelResponse);

      expect(global.fetch).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-openai-key',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful Spanish language learning assistant. The user message fills in the blank: "explain or translate what _____ means in English." IMPORTANT: do not repeat original Spanish word or phrase in response.'
            },
            {
              role: 'user',
              content: 'gato'
            }
          ],
          max_tokens: 500,
          temperature: 0.7,
        }),
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        response: 'It means "cat" in English.'
      });
    });

    it('should handle OpenAI API errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await handler(req as VercelRequest, res as VercelResponse);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Failed to get response from AI' });
    });

    it('should handle network errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      await handler(req as VercelRequest, res as VercelResponse);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Failed to get response from AI' });
    });

    it('should handle empty OpenAI response', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: null } }]
        }),
      });

      await handler(req as VercelRequest, res as VercelResponse);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Failed to get response from AI' });
    });

    it('should handle malformed OpenAI response', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: []
        }),
      });

      await handler(req as VercelRequest, res as VercelResponse);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Failed to get response from AI' });
    });
  });
});