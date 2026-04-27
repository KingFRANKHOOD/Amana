declare module 'ioredis' {
  export default class Redis {
    constructor(url?: string);
    get(...args: any[]): Promise<any>;
    set(...args: any[]): Promise<any>;
    del(...args: any[]): Promise<any>;
    exists(...args: any[]): Promise<any>;
  }
}

declare module 'express-rate-limit' {
  const rateLimit: (options: any) => any;
  export default rateLimit;
}

declare module 'zod' {
  export const z: any;
  export namespace z {
    export type infer<T> = any;
  }
}
