export interface FileMetadata {
  id: string; // Unique ID for the file
  name: string;
  size: number;
  type: string;
  path: string; // Folder hierarchy
  lastModified?: number;
}

export interface Session {
  id: string; // 6-digit or UUID server ID
  hostSocketId: string;
  lastActive: number;
  metadata: Record<string, FileMetadata>; // Mapping of file ID to metadata
  joiners: Set<string>; // Socket IDs of connected joiners
}

export interface JoinerRequest {
  fileId: string;
  joinerSocketId: string;
}
