declare module 'ioredis' {
  export default class Redis {
    constructor(url?: string);
    get(...args: any[]): Promise<any>;
    set(...args: any[]): Promise<any>;
    del(...args: any[]): Promise<any>;
    exists(...args: any[]): Promise<any>;
    keys(...args: any[]): Promise<any>;
  }
}

declare module 'express-rate-limit' {
  const rateLimit: (options: any) => any;
  export default rateLimit;
}


