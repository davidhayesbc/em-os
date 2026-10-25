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
import {
  peopleAddIdentity,
  peopleCreate,
  peopleGet,
  peopleList,
  peopleResolve,
  peopleUpdate,
  personNotesCreate,
  personNotesList,
} from "./people.js";
import { serviceShutdown } from "./service.js";
import { layoutGet, layoutSet, settingsGet, settingsUpdate } from "./settings.js";
import { commitmentsQuickCapture } from "./quick-capture.js";

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
  "settings.get": settingsGet,
  "settings.update": settingsUpdate,
  "layout.get": layoutGet,
  "layout.set": layoutSet,
  "people.list": peopleList,
  "people.get": peopleGet,
  "people.create": peopleCreate,
  "people.update": peopleUpdate,
  "people.addIdentity": peopleAddIdentity,
  "people.resolve": peopleResolve,
  "personNotes.create": personNotesCreate,
  "personNotes.list": personNotesList,
  "commitments.quickCapture": commitmentsQuickCapture,
};
