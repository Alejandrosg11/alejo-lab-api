export interface SightengineGenAiResponse {
  status?: string;
  request?: {
    id?: string;
    timestamp?: number | string;
    operations?: number;
  };
  type?: {
    ai_generated?: number;
  };
  media?: {
    id?: string;
    uri?: string;
  };
}
