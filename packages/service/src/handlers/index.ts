import type { OpName } from "@emos/api-contract";
import type { Handler } from "../context.js";
import { backupCreate } from "./backup.js";
import {
  commitmentsComplete,
  commitmentsCreate,
  commitmentsDrop,
  commitmentsGet,
  commitmentsList,
  commitmentsPin,
  commitmentsReopenHandler,
  commitmentsSnooze,
  commitmentsUpdate,
} from "./commitments.js";
import { goalsCreate, goalsList, goalsUpdate } from "./goals.js";
import { healthGet } from "./health.js";
import { serviceShutdown } from "./service.js";

// Append-only registry, keyed by op name (see @emos/api-contract ops). Other tasks add entries.
export const handlers: { [N in OpName]?: Handler<N> } = {
  "health.get": healthGet,
  "backup.create": backupCreate,
  "service.shutdown": serviceShutdown,
  "commitments.list": commitmentsList,
  "commitments.get": commitmentsGet,
  "commitments.create": commitmentsCreate,
  "commitments.update": commitmentsUpdate,
  "commitments.complete": commitmentsComplete,
  "commitments.snooze": commitmentsSnooze,
  "commitments.drop": commitmentsDrop,
  "commitments.reopen": commitmentsReopenHandler,
  "commitments.pin": commitmentsPin,
  "goals.list": goalsList,
  "goals.create": goalsCreate,
  "goals.update": goalsUpdate,
};
