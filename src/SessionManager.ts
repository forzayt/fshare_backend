import { Session, FileMetadata } from './types';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

class SessionManager {
  private sessions: Map<string, Session> = new Map();

  constructor() {
    // No more periodic cleanup for expiry
  }

  private generateSecureId(): string {
    // Generate a secure 12-character alphanumeric string (excluding confusing characters like O/0, I/1)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const randomBytes = crypto.randomBytes(12);
    let id = '';
    for (let i = 0; i < 12; i++) {
      id += chars[randomBytes[i] % chars.length];
    }
    // Format as XXXX-XXXX-XXXX
    return `${id.slice(0, 4)}-${id.slice(4, 8)}-${id.slice(8, 12)}`;
  }

  public createSession(hostSocketId: string): string {
    let sessionId = this.generateSecureId();
    
    // Ensure uniqueness
    while (this.sessions.has(sessionId)) {
      sessionId = this.generateSecureId();
    }

    const now = Date.now();
    this.sessions.set(sessionId, {
      id: sessionId,
      hostSocketId,
      lastActive: now,
      metadata: {},
      joiners: new Set(),
    });

    return sessionId;
  }

  public getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  public updateHostSocketId(sessionId: string, newHostSocketId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.hostSocketId = newHostSocketId;
      session.lastActive = Date.now();
      return true;
    }
    return false;
  }

  public getSessionByHostSocketId(socketId: string): Session | undefined {
    for (const session of this.sessions.values()) {
      if (session.hostSocketId === socketId) {
        return session;
      }
    }
    return undefined;
  }

  public getSessionsByJoinerSocketId(socketId: string): Session[] {
    const matched: Session[] = [];
    for (const session of this.sessions.values()) {
      if (session.joiners.has(socketId)) {
        matched.push(session);
      }
    }
    return matched;
  }

  public removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  public joinSession(sessionId: string, joinerSocketId: string): boolean {
    const session = this.getSession(sessionId);
    if (session) {
      session.joiners.add(joinerSocketId);
      return true;
    }
    return false;
  }

  public leaveSession(sessionId: string, joinerSocketId: string): void {
    const session = this.getSession(sessionId);
    if (session) {
      session.joiners.delete(joinerSocketId);
    }
  }

  public updateMetadata(sessionId: string, metadata: FileMetadata[]): boolean {
    const session = this.getSession(sessionId);
    if (session) {
      // Clear old metadata and set new
      session.metadata = {};
      metadata.forEach(file => {
        // use file id if provided, else generate one
        const id = file.id || uuidv4();
        session.metadata[id] = { ...file, id };
      });
      return true;
    }
    return false;
  }
  
  public getMetadata(sessionId: string): FileMetadata[] {
    const session = this.getSession(sessionId);
    if (session) {
      return Object.values(session.metadata);
    }
    return [];
  }
}

export const sessionManager = new SessionManager();
