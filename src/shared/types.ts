export type ProviderId = 'reddit' | 'twitter' | 'local';

export type BlockCategory = 'Sources' | 'Enrichment' | 'Transform' | 'Output' | 'Utility';

export type BlockPriority = 'P0' | 'P1';

export type PortType = 'SocialItem[]' | 'DetailObject' | 'FileArtifact' | 'Any';

export interface PortSpec {
  id: string;
  label: string;
  type: PortType;
}

export interface BlockPorts {
  input: PortSpec[];
  output: PortSpec[];
}

export interface FieldOption {
  label: string;
  value: string | number | boolean;
}

export interface FieldSpec {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean' | 'path';
  required?: boolean;
  min?: number;
  max?: number;
  options?: FieldOption[];
  help?: string;
}

export interface BlockSpec {
  type: string;
  label: string;
  provider: ProviderId;
  category: BlockCategory;
  priority: BlockPriority;
  description: string;
  ports: BlockPorts;
  fields: FieldSpec[];
  defaultSettings: Record<string, unknown>;
  command?: {
    executable: 'rdt' | 'twitter';
  };
}

export interface CommandBuildInput {
  blockId: string;
  blockType: string;
  settings: Record<string, unknown>;
}

export interface BuiltCommand {
  provider: Exclude<ProviderId, 'local'>;
  executable: 'rdt' | 'twitter';
  argv: string[];
  displayArgv: string[];
}

export interface SocialItem {
  platform: 'reddit' | 'twitter';
  sourceBlockId: string;
  id: string;
  url: string | null;
  author: string | null;
  community: string | null;
  title: string | null;
  body: string | null;
  text: string;
  createdAt: string;
  engagement: {
    score?: number | null;
    comments?: number | null;
    replies?: number | null;
    likes?: number | null;
    retweets?: number | null;
    bookmarks?: number | null;
    views?: number | null;
  };
  media: Array<{ type: string; url: string }>;
  links: string[];
  raw: Record<string, unknown>;
}

