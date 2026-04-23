import { Request, Response, NextFunction } from "express";
import { AnyZodObject, ZodError } from "zod";
import { AppError, ErrorCode } from "../errors/errorCodes";

export const validateRequest = (schema: {
  body?: AnyZodObject;
  query?: AnyZodObject;
  params?: AnyZodObject;
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
      if (error instanceof ZodError) {
        return next(
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            "Validation failed",
            400,
            error.errors.map((e) => ({
              path: e.path.join("."),
              message: e.message,
            }))
          )
        );
      }
      next(error);
    }
  };
};
