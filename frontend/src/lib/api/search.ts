import { request } from "./client";
import type { SearchResponse } from "./types";

export const searchApi = {
  query: (token: string, q: string) =>
    request<SearchResponse>(`/search?q=${encodeURIComponent(q)}`, { token }),
};
