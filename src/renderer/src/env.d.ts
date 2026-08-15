/// <reference types="vite/client" />
import type { IslandApi } from '../../preload/index';

declare global {
  interface Window {
    api: IslandApi;
  }
}

export {};
