import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import { setupSocket } from './socket';
import { sessionManager } from './SessionManager';

const fastify = Fastify({
  logger: true
});

// Configure CORS
fastify.register(cors, {
  origin: '*', // Allow all for MVP, should restrict in production
  methods: ['GET', 'POST', 'PUT', 'DELETE']
});

// Basic Health Check Route
fastify.get('/', async (request, reply) => {
  return 'OK';
});

fastify.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Validate Session Route
fastify.get('/api/v1/session/:id/validate', async (request, reply) => {
  const { id } = request.params as { id: string };
  const session = sessionManager.getSession(id);
  
  if (session) {
    return { valid: true };
  } else {
    reply.status(404);
    return { valid: false, error: 'Session not found' };
  }
});

// Start Server
const start = async () => {
  try {
    // We must await fastify.ready() before binding socket.io to the server
    await fastify.ready();
    
    // Attach Socket.io to the Fastify raw HTTP server
    const io = new Server(fastify.server, {
      cors: {
        origin: '*', // Allow all for MVP
        methods: ['GET', 'POST']
      }
    });

    // Setup Socket.IO events
    setupSocket(io);

    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`Server listening on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
