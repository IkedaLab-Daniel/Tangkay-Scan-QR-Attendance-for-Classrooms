import request from 'supertest';
import app from '../index';
import { openApiSpec } from '../docs/openapi';

describe('Scalar & Morgan Integration', () => {
  describe('GET /openapi.json', () => {
    it('returns the OpenAPI 3.1.0 specification object', async () => {
      const res = await request(app).get('/openapi.json');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body.openapi).toBe('3.1.0');
      expect(res.body.info.title).toBe('TangkayScan API');
      expect(res.body.paths).toHaveProperty('/health');
      expect(res.body.paths).toHaveProperty('/api/auth/teacher/signup');
      expect(res.body.paths).toHaveProperty('/api/sessions');
      expect(res.body).toEqual(openApiSpec);
    });
  });

  describe('GET /reference', () => {
    it('renders the Scalar API Reference HTML documentation page', async () => {
      const res = await request(app).get('/reference');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('Scalar API Reference');
      expect(res.text).toContain('TangkayScan API');
      expect(res.text).toContain('@scalar/api-reference');
    });
  });

  describe('GET /docs', () => {
    it('redirects /docs to /reference', async () => {
      const res = await request(app).get('/docs');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/reference');
    });
  });

  describe('Morgan Logger Middleware', () => {
    it('is registered in the Express middleware pipeline', () => {
      // Morgan names its middleware function 'logger' in Express stack
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stack = (app as any)._router.stack;
      const hasMorgan = stack.some(
        (layer: { name: string }) => layer.name === 'logger' || layer.name === 'morgan',
      );
      expect(hasMorgan).toBe(true);
    });

    it('formats HTTP request logs correctly', async () => {
      const express = (await import('express')).default;
      const morgan = (await import('morgan')).default;
      const testApp = express();
      let logged = '';

      testApp.use(
        morgan('dev', {
          stream: {
            write: (msg: string) => {
              logged += msg;
            },
          },
        }),
      );

      testApp.get('/test-morgan', (_req, res) => {
        res.status(200).send('ok');
      });

      await request(testApp).get('/test-morgan');
      expect(logged).toMatch(/GET \/test-morgan/);
      expect(logged).toMatch(/200/);
    });
  });
});
