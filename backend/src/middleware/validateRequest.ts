import { Request, Response, NextFunction } from "express";

type ParseAsyncSchema = {
  parseAsync: (input: unknown) => Promise<unknown>;
};

type ZodLikeIssue = {
  path: Array<string | number>;
  message: string;
};

function getZodLikeIssues(error: unknown): ZodLikeIssue[] | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const err = error as any;
  if (Array.isArray(err.issues)) {
    return err.issues;
  }
  if (Array.isArray(err.errors)) {
    return err.errors;
  }

  return null;
}

export const validateRequest = (schema: {
  body?: ParseAsyncSchema;
  query?: ParseAsyncSchema;
  params?: ParseAsyncSchema;
}) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schema.body) {
        req.body = await schema.body.parseAsync(req.body);
      }
      if (schema.query) {
        req.query = await schema.query.parseAsync(req.query) as any;
      }
      if (schema.params) {
        req.params = await schema.params.parseAsync(req.params) as any;
      }
      next();
    } catch (error) {
      const issues = getZodLikeIssues(error);
      if (issues?.length) {
        const firstError = issues[0];
        const fieldName = firstError.path.join(".");
        const message = fieldName ? `${fieldName}: ${firstError.message}` : firstError.message;
        return res.status(400).json({ error: message });
      }
      next(error);
    }
  };
};
