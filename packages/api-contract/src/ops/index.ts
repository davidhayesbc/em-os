import { backupCreate } from "./backup.js";
import {
  commitmentsComplete,
  commitmentsCreate,
  commitmentsDrop,
  commitmentsGet,
  commitmentsList,
  commitmentsPin,
  commitmentsReopen,
  commitmentsSnooze,
  commitmentsUpdate,
} from "./commitments.js";
import { goalsCreate, goalsList, goalsUpdate } from "./goals.js";
import { healthGet } from "./health.js";
import { serviceShutdown } from "./service.js";

// Append-only registry, keyed by op name. Other tasks add entries.
export const ops = {
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
  "commitments.reopen": commitmentsReopen,
  "commitments.pin": commitmentsPin,
  "goals.list": goalsList,
  "goals.create": goalsCreate,
  "goals.update": goalsUpdate,
} as const;
