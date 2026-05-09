import { Server, Socket } from 'socket.io';
import { sessionManager } from './SessionManager';
import { FileMetadata } from './types';

export function setupSocket(io: Server) {
  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] User connected: ${socket.id}`);

    // --- Host Events ---
    
    // Host starts a new server
    socket.on('host:start', (payload: { sessionId?: string }, callback) => {
      let sessionId = payload?.sessionId;
      let isResume = false;

      if (sessionId) {
        const session = sessionManager.getSession(sessionId);
        if (session) {
          sessionManager.updateHostSocketId(sessionId, socket.id);
          socket.join(`session_${sessionId}`);
          isResume = true;
          console.log(`[Session] Host ${socket.id} resumed session ${sessionId}`);
        } else {
          sessionId = sessionManager.createSession(socket.id);
          socket.join(`session_${sessionId}`);
          console.log(`[Session] Host ${socket.id} created new session ${sessionId} (resume failed)`);
        }
      } else {
        sessionId = sessionManager.createSession(socket.id);
        socket.join(`session_${sessionId}`);
        console.log(`[Session] Host ${socket.id} created session ${sessionId}`);
      }
      
      const session = sessionManager.getSession(sessionId);
      if (typeof callback === 'function') {
        callback({ 
          success: true, 
          sessionId,
          isResume,
          joiners: isResume ? Array.from(session?.joiners || []) : []
        });
      }
    });

    // Host updates metadata
    socket.on('host:update_metadata', (payload: { sessionId: string; metadata: FileMetadata[] }, callback) => {
      const { sessionId, metadata } = payload;
      const session = sessionManager.getSession(sessionId);
      
      if (!session || session.hostSocketId !== socket.id) {
        if (typeof callback === 'function') callback({ success: false, error: 'Unauthorized or session not found' });
        return;
      }

      sessionManager.updateMetadata(sessionId, metadata);
      
      // Notify all joiners about the metadata update
      socket.to(`session_${sessionId}`).emit('session:metadata_updated', sessionManager.getMetadata(sessionId));
      
      if (typeof callback === 'function') callback({ success: true });
    });

    // Host manual shutdown
    socket.on('host:shutdown', (payload: { sessionId: string }, callback) => {
      const { sessionId } = payload;
      const session = sessionManager.getSession(sessionId);
      
      if (session && session.hostSocketId === socket.id) {
        // Notify joiners
        socket.to(`session_${sessionId}`).emit('session:closed');
        sessionManager.removeSession(sessionId);
        if (typeof callback === 'function') callback({ success: true });
      } else {
        if (typeof callback === 'function') callback({ success: false, error: 'Unauthorized' });
      }
    });


    // --- Joiner Events ---

    // Joiner connects to a session
    socket.on('joiner:join', (payload: { sessionId: string }, callback) => {
      const { sessionId } = payload;
      const session = sessionManager.getSession(sessionId);

      if (!session) {
        if (typeof callback === 'function') callback({ success: false, error: 'Session not found or expired' });
        return;
      }

      // Join the session room
      socket.join(`session_${sessionId}`);
      sessionManager.joinSession(sessionId, socket.id);
      console.log(`[Session] Joiner ${socket.id} joined session ${sessionId}`);

      // Notify host that a new joiner arrived
      io.to(session.hostSocketId).emit('host:joiner_connected', { joinerId: socket.id });

      if (typeof callback === 'function') {
        callback({ 
          success: true, 
          metadata: sessionManager.getMetadata(sessionId)
        });
      }
    });

    // Joiner leaves a session (route change/manual leave)
    socket.on('joiner:leave', (payload: { sessionId: string }) => {
      const { sessionId } = payload;
      const session = sessionManager.getSession(sessionId);
      if (session) {
        console.log(`[Session] Joiner ${socket.id} left session ${sessionId}`);
        sessionManager.leaveSession(sessionId, socket.id);
        socket.leave(`session_${sessionId}`);
        io.to(session.hostSocketId).emit('host:joiner_disconnected', { joinerId: socket.id });
      }
    });

    // --- WebRTC Signaling ---
    
    // Forwarding Offer
    socket.on('webrtc:offer', (payload: { targetId: string; offer: RTCSessionDescriptionInit; sessionId: string; fileId?: string }) => {
      console.log(`[WebRTC] Offer from ${socket.id} to ${payload.targetId} for file ${payload.fileId}`);
      io.to(payload.targetId).emit('webrtc:offer', {
        senderId: socket.id,
        offer: payload.offer,
        fileId: payload.fileId,
      });
    });

    // Forwarding Answer
    socket.on('webrtc:answer', (payload: { targetId: string; answer: RTCSessionDescriptionInit; sessionId: string; fileId?: string }) => {
      console.log(`[WebRTC] Answer from ${socket.id} to ${payload.targetId} for file ${payload.fileId}`);
      io.to(payload.targetId).emit('webrtc:answer', {
        senderId: socket.id,
        answer: payload.answer,
        fileId: payload.fileId,
      });
    });

    // Forwarding ICE Candidate
    socket.on('webrtc:ice_candidate', (payload: { targetId: string; candidate: RTCIceCandidateInit; sessionId: string; fileId?: string }) => {
      io.to(payload.targetId).emit('webrtc:ice_candidate', {
        senderId: socket.id,
        candidate: payload.candidate,
        fileId: payload.fileId,
      });
    });


    // --- File Request Events (For establishing specific transfers over WebRTC data channels) ---
    // Note: The actual transfer happens via WebRTC, but signaling the intent helps the UI.
    socket.on('joiner:request_file', (payload: { sessionId: string; fileId: string }, callback) => {
      const { sessionId, fileId } = payload;
      const session = sessionManager.getSession(sessionId);

      if (!session) {
        if (typeof callback === 'function') callback({ success: false, error: 'Session not found' });
        return;
      }

      // Forward request to host
      io.to(session.hostSocketId).emit('host:file_requested', {
        joinerId: socket.id,
        fileId
      });

      if (typeof callback === 'function') callback({ success: true });
    });


    // --- Disconnect ---
    socket.on('disconnect', () => {
      console.log(`[Socket] User disconnected: ${socket.id}`);
      
      // 1. Handle Host Disconnection
      const hostedSession = sessionManager.getSessionByHostSocketId(socket.id);
      if (hostedSession) {
        console.log(`[Session] Host ${socket.id} went offline for session ${hostedSession.id}`);
        // We DON'T delete the session here anymore, to allow resuming.
        // We can notify joiners if we want, but usually we just wait for host to come back.
        // socket.to(`session_${hostedSession.id}`).emit('session:host_offline');
      }

      // 2. Handle Joiner Disconnection
      const joinerSessions = sessionManager.getSessionsByJoinerSocketId(socket.id);
      joinerSessions.forEach(session => {
        console.log(`[Session] Joiner ${socket.id} disconnected from session ${session.id}`);
        sessionManager.leaveSession(session.id, socket.id);
        // Only notify if host is still online
        io.to(session.hostSocketId).emit('host:joiner_disconnected', { joinerId: socket.id });
      });
    });
  });
}
