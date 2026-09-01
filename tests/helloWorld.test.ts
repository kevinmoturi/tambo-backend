import request from 'supertest';
import app from '../src/app';

describe('GET /api/hello', () => {
  it('should return a Hello, World! message', async () => {
    const response = await request(app).get('/api/hello');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'Hello, World!' });
  });
});
