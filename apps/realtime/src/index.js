import 'dotenv/config';
import { createServer } from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import { loadConfig, realtimeEnvSchema } from '@workspace/config';
import { logger } from '@workspace/logger';

async function start() {
  try {
    const config = loadConfig(realtimeEnvSchema);

    // Setup Express for health checks
    const app = express();
    app.get('/health', (req, res) => res.json({ status: 'ok' }));

    // Create HTTP server
    const httpServer = createServer(app);

    // Initialize Socket.io (no domain logic yet)
    const io = new Server(httpServer, {
      cors: {
        origin: '*', // To be restricted later
      },
    });

    io.on('connection', (socket) => {
      logger.info({ socketId: socket.id }, 'Client connected to realtime server');
      socket.on('disconnect', () => {
        logger.info({ socketId: socket.id }, 'Client disconnected from realtime server');
      });
    });

    // Start listening
    httpServer.listen(config.REALTIME_PORT, () => {
      logger.info(
        { port: config.REALTIME_PORT },
        'Realtime server successfully started and listening',
      );
    });

    const shutdown = () => {
      logger.info('Shutting down realtime server...');
      io.close(() => {
        httpServer.close(() => {
          logger.info('Realtime server closed');
          process.exit(0);
        });
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    logger.fatal({ err }, 'Failed to start Realtime server');
    process.exit(1);
  }
}

start();
