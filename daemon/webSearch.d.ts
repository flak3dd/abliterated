export function searchWeb(opts: {
  query?: string;
  count?: number;
  braveKey?: string;
  searxUrl?: string;
}): Promise<string>;
