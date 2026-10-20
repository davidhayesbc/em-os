import { z } from "zod";
import { ERROR_CODES } from "./errors.js";

/** Zod enum of the error codes, for schemas that carry one. */
export const ErrorCodeSchema = z.enum(ERROR_CODES);
